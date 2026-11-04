-- Milestone 3: server-authoritative synchronized paired capture
--
-- Extends the additive capture-session foundation from migration 005. Browser
-- roles remain closed out; every mutation is capability-authorized and bound to
-- the active participant-generation lease introduced in migration 006.

ALTER TABLE room_capture_sessions
  DROP CONSTRAINT room_capture_sessions_valid_phase;

ALTER TABLE room_capture_sessions
  ADD CONSTRAINT room_capture_sessions_valid_phase CHECK (
    phase IN (
      'camera_setup',
      'preparing',
      'countdown',
      'capturing',
      'completed',
      'selecting',
      'editing',
      'finalizing',
      'finalized'
    )
  );

ALTER TABLE capture_attempts
  ADD COLUMN opaque_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid();

ALTER TABLE capture_images
  ADD COLUMN retry_scheduled_at timestamptz,
  ADD CONSTRAINT capture_images_retry_after_creation CHECK (
    retry_scheduled_at IS NULL OR retry_scheduled_at >= created_at
  );

CREATE INDEX idx_capture_attempts_opaque_id
  ON capture_attempts(opaque_id);

-- At most one unfinished attempt may own a logical moment. A stale attempt is
-- cancelled before its replacement is inserted.
CREATE UNIQUE INDEX idx_capture_attempts_one_open_per_moment
  ON capture_attempts(moment_id)
  WHERE result_state IN ('pending', 'partial');

CREATE OR REPLACE FUNCTION clear_capture_readiness_on_client_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.active_webrtc_client_id IS DISTINCT FROM OLD.active_webrtc_client_id
    OR NEW.active_client_generation IS DISTINCT FROM OLD.active_client_generation
    OR NEW.lease_expires_at IS NULL
  THEN
    NEW.is_ready := false;
    NEW.ready_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capture_session_members_clear_readiness
BEFORE UPDATE ON capture_session_members
FOR EACH ROW
EXECUTE FUNCTION clear_capture_readiness_on_client_change();

CREATE OR REPLACE FUNCTION schedule_next_synchronized_capture(
  p_session_id uuid,
  p_now timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_moment_id uuid;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_generation integer;
  v_completed_count integer;
BEGIN
  -- The caller holds the room/session mutation lock. Recover attempts that can
  -- no longer be safely executed after a refresh or long network interruption.
  UPDATE capture_attempts
  SET result_state = 'cancelled'
  WHERE session_id = p_session_id
    AND result_state IN ('pending', 'partial')
    AND scheduled_capture_at < p_now - INTERVAL '90 seconds'
    AND NOT EXISTS (
      SELECT 1
      FROM capture_images AS image
      WHERE image.attempt_id = capture_attempts.id
        AND image.upload_status = 'verified'
    );

  IF EXISTS (
    SELECT 1
    FROM capture_attempts
    WHERE session_id = p_session_id
      AND result_state IN ('pending', 'partial')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(DISTINCT attempt.moment_id)::integer
  INTO v_completed_count
  FROM capture_attempts AS attempt
  WHERE attempt.session_id = p_session_id
    AND attempt.result_state = 'complete';

  IF v_completed_count = 6 THEN
    UPDATE room_capture_sessions
    SET phase = 'completed'
    WHERE id = p_session_id
      AND phase != 'completed';
    RETURN NULL;
  END IF;

  SELECT moment.id
  INTO v_moment_id
  FROM capture_moments AS moment
  WHERE moment.session_id = p_session_id
    AND NOT EXISTS (
      SELECT 1
      FROM capture_attempts AS attempt
      WHERE attempt.moment_id = moment.id
        AND attempt.result_state = 'complete'
    )
  ORDER BY moment.capture_index
  LIMIT 1;

  IF v_moment_id IS NULL THEN
    RAISE EXCEPTION 'capture_moment_state_invalid';
  END IF;

  SELECT COALESCE(MAX(attempt.attempt_number), 0) + 1
  INTO v_attempt_number
  FROM capture_attempts AS attempt
  WHERE attempt.moment_id = v_moment_id;

  SELECT GREATEST(MAX(member.active_client_generation), 1)
  INTO v_generation
  FROM capture_session_members AS member
  WHERE member.session_id = p_session_id;

  INSERT INTO capture_attempts (
    session_id,
    moment_id,
    attempt_number,
    generation,
    scheduled_capture_at,
    preparation_state,
    armed_state,
    result_state
  ) VALUES (
    p_session_id,
    v_moment_id,
    v_attempt_number,
    v_generation,
    p_now + INTERVAL '5 seconds',
    'ready',
    'armed',
    'pending'
  )
  RETURNING id INTO v_attempt_id;

  -- The storage-path trigger replaces the placeholder with an opaque path.
  INSERT INTO capture_images (
    session_id,
    attempt_id,
    participant_id,
    storage_path
  )
  SELECT p_session_id, v_attempt_id, member.participant_id, ''
  FROM capture_session_members AS member
  WHERE member.session_id = p_session_id;

  UPDATE room_capture_sessions
  SET phase = 'countdown'
  WHERE id = p_session_id;

  RETURN v_attempt_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_synchronized_capture_readiness(
  p_room_code text,
  p_capability_hash text,
  p_client_id uuid,
  p_generation integer,
  p_is_ready boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_participant_id uuid;
  v_session room_capture_sessions%ROWTYPE;
  v_member capture_session_members%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_ready_count integer;
  v_live_lease_count integer;
BEGIN
  SELECT room.* INTO v_room
  FROM rooms AS room
  WHERE room.code = p_room_code
  FOR UPDATE;

  IF v_room.id IS NULL
    OR v_room.expires_at <= v_now
    OR v_room.state != 'active'
    OR v_room.finalized_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM participants AS participant
  WHERE participant.room_id = v_room.id
    AND participant.capability_hash = p_capability_hash;

  SELECT capture_session.* INTO v_session
  FROM room_capture_sessions AS capture_session
  WHERE capture_session.room_id = v_room.id
    AND capture_session.is_current
  FOR UPDATE;

  SELECT member.* INTO v_member
  FROM capture_session_members AS member
  WHERE member.session_id = v_session.id
    AND member.participant_id = v_participant_id
  FOR UPDATE;

  IF v_member.participant_id IS NULL
    OR v_member.active_webrtc_client_id IS DISTINCT FROM p_client_id
    OR v_member.active_client_generation != p_generation
    OR v_member.lease_expires_at <= v_now
  THEN
    RAISE EXCEPTION 'capture_client_lease_lost';
  END IF;

  IF v_session.phase = 'completed' THEN
    RETURN true;
  END IF;

  UPDATE capture_session_members
  SET is_ready = p_is_ready,
      ready_at = CASE WHEN p_is_ready THEN v_now ELSE NULL END,
      last_heartbeat_at = v_now
  WHERE session_id = v_session.id
    AND participant_id = v_participant_id;

  IF NOT p_is_ready THEN
    UPDATE capture_attempts
    SET result_state = 'cancelled'
    WHERE session_id = v_session.id
      AND result_state = 'pending'
      AND scheduled_capture_at > v_now
      AND NOT EXISTS (
        SELECT 1 FROM capture_images AS image
        WHERE image.attempt_id = capture_attempts.id
          AND image.upload_status = 'verified'
      );

    UPDATE room_capture_sessions
    SET phase = 'preparing'
    WHERE id = v_session.id;
    RETURN true;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE member.is_ready)::integer,
    COUNT(*) FILTER (
      WHERE member.is_ready
        AND member.lease_expires_at > v_now
        AND member.active_webrtc_client_id IS NOT NULL
    )::integer
  INTO v_ready_count, v_live_lease_count
  FROM capture_session_members AS member
  WHERE member.session_id = v_session.id;

  IF v_ready_count = 2 AND v_live_lease_count = 2 THEN
    PERFORM schedule_next_synchronized_capture(v_session.id, v_now);
  ELSE
    UPDATE room_capture_sessions
    SET phase = 'preparing'
    WHERE id = v_session.id
      AND phase != 'preparing';
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION complete_synchronized_capture_upload(
  p_room_code text,
  p_capability_hash text,
  p_client_id uuid,
  p_generation integer,
  p_attempt_opaque_id uuid,
  p_width_px integer,
  p_height_px integer,
  p_file_size_bytes bigint,
  p_captured_at timestamptz,
  p_capture_metadata jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_participant_id uuid;
  v_session room_capture_sessions%ROWTYPE;
  v_member capture_session_members%ROWTYPE;
  v_attempt capture_attempts%ROWTYPE;
  v_image capture_images%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_verified_count integer;
  v_completed_count integer;
  v_ready_count integer;
  v_live_lease_count integer;
BEGIN
  IF p_width_px <= 0 OR p_height_px <= 0
    OR p_file_size_bytes <= 0 OR p_file_size_bytes > 10485760
    OR p_captured_at IS NULL
    OR jsonb_typeof(p_capture_metadata) != 'object'
    OR octet_length(p_capture_metadata::text) > 8192
  THEN
    RAISE EXCEPTION 'capture_upload_metadata_invalid';
  END IF;

  SELECT room.* INTO v_room
  FROM rooms AS room
  WHERE room.code = p_room_code
  FOR UPDATE;

  IF v_room.id IS NULL
    OR v_room.expires_at <= v_now
    OR v_room.state != 'active'
    OR v_room.finalized_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM participants AS participant
  WHERE participant.room_id = v_room.id
    AND participant.capability_hash = p_capability_hash;

  SELECT capture_session.* INTO v_session
  FROM room_capture_sessions AS capture_session
  WHERE capture_session.room_id = v_room.id
    AND capture_session.is_current
  FOR UPDATE;

  SELECT member.* INTO v_member
  FROM capture_session_members AS member
  WHERE member.session_id = v_session.id
    AND member.participant_id = v_participant_id;

  IF v_member.participant_id IS NULL
    OR v_member.active_webrtc_client_id IS DISTINCT FROM p_client_id
    OR v_member.active_client_generation != p_generation
  THEN
    RAISE EXCEPTION 'capture_client_lease_lost';
  END IF;

  SELECT attempt.* INTO v_attempt
  FROM capture_attempts AS attempt
  WHERE attempt.session_id = v_session.id
    AND attempt.opaque_id = p_attempt_opaque_id
  FOR UPDATE;

  IF v_attempt.id IS NULL OR v_attempt.result_state IN ('failed', 'cancelled') THEN
    RAISE EXCEPTION 'capture_attempt_unavailable';
  END IF;

  SELECT image.* INTO v_image
  FROM capture_images AS image
  WHERE image.attempt_id = v_attempt.id
    AND image.participant_id = v_participant_id
  FOR UPDATE;

  IF v_image.id IS NULL THEN
    RAISE EXCEPTION 'capture_image_unavailable';
  END IF;

  IF v_image.upload_status != 'verified' THEN
    UPDATE capture_images
    SET upload_status = 'verified',
        width_px = p_width_px,
        height_px = p_height_px,
        file_size_bytes = p_file_size_bytes,
        captured_at = p_captured_at,
        capture_metadata = p_capture_metadata,
        retry_scheduled_at = NULL
    WHERE id = v_image.id;
  END IF;

  SELECT COUNT(*) FILTER (WHERE image.upload_status = 'verified')::integer
  INTO v_verified_count
  FROM capture_images AS image
  WHERE image.attempt_id = v_attempt.id;

  IF v_verified_count = 2 THEN
    UPDATE capture_attempts
    SET armed_state = 'released', result_state = 'complete'
    WHERE id = v_attempt.id;

    SELECT COUNT(DISTINCT attempt.moment_id)::integer
    INTO v_completed_count
    FROM capture_attempts AS attempt
    WHERE attempt.session_id = v_session.id
      AND attempt.result_state = 'complete';

    IF v_completed_count = 6 THEN
      UPDATE room_capture_sessions
      SET phase = 'completed'
      WHERE id = v_session.id;
    ELSE
      SELECT
        COUNT(*) FILTER (WHERE member.is_ready)::integer,
        COUNT(*) FILTER (
          WHERE member.is_ready
            AND member.lease_expires_at > v_now
            AND member.active_webrtc_client_id IS NOT NULL
        )::integer
      INTO v_ready_count, v_live_lease_count
      FROM capture_session_members AS member
      WHERE member.session_id = v_session.id;

      IF v_ready_count = 2 AND v_live_lease_count = 2 THEN
        PERFORM schedule_next_synchronized_capture(v_session.id, v_now);
      ELSE
        UPDATE room_capture_sessions
        SET phase = 'preparing'
        WHERE id = v_session.id;
      END IF;
    END IF;

    RETURN 'complete';
  END IF;

  UPDATE capture_attempts
  SET result_state = 'partial'
  WHERE id = v_attempt.id;

  UPDATE room_capture_sessions
  SET phase = 'capturing'
  WHERE id = v_session.id
    AND phase != 'capturing';

  RETURN 'partial';
END;
$$;

CREATE OR REPLACE FUNCTION restart_synchronized_capture_attempt(
  p_room_code text,
  p_capability_hash text,
  p_client_id uuid,
  p_generation integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_participant_id uuid;
  v_session room_capture_sessions%ROWTYPE;
  v_member capture_session_members%ROWTYPE;
  v_attempt capture_attempts%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_ready_count integer;
  v_live_lease_count integer;
  v_verified_count integer;
  v_requester_upload_status text;
BEGIN
  SELECT room.* INTO v_room
  FROM rooms AS room
  WHERE room.code = p_room_code
  FOR UPDATE;

  IF v_room.id IS NULL OR v_room.expires_at <= v_now OR v_room.state != 'active' THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  SELECT participant.id INTO v_participant_id
  FROM participants AS participant
  WHERE participant.room_id = v_room.id
    AND participant.capability_hash = p_capability_hash;

  SELECT capture_session.* INTO v_session
  FROM room_capture_sessions AS capture_session
  WHERE capture_session.room_id = v_room.id
    AND capture_session.is_current
  FOR UPDATE;

  SELECT member.* INTO v_member
  FROM capture_session_members AS member
  WHERE member.session_id = v_session.id
    AND member.participant_id = v_participant_id;

  IF v_member.participant_id IS NULL
    OR v_member.active_webrtc_client_id IS DISTINCT FROM p_client_id
    OR v_member.active_client_generation != p_generation
    OR v_member.lease_expires_at <= v_now
  THEN
    RAISE EXCEPTION 'capture_client_lease_lost';
  END IF;

  SELECT attempt.* INTO v_attempt
  FROM capture_attempts AS attempt
  WHERE attempt.session_id = v_session.id
    AND attempt.result_state IN ('pending', 'partial')
  FOR UPDATE;

  IF v_attempt.id IS NULL
    OR v_attempt.scheduled_capture_at > v_now - INTERVAL '2 seconds'
  THEN
    RAISE EXCEPTION 'capture_attempt_not_restartable';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE image.upload_status = 'verified')::integer,
    MAX(image.upload_status) FILTER (WHERE image.participant_id = v_participant_id)
  INTO v_verified_count, v_requester_upload_status
  FROM capture_images AS image
  WHERE image.attempt_id = v_attempt.id;

  -- If one side is already safely stored, keep the same moment and attempt.
  -- Only the missing participant receives a new server time; the verified peer
  -- will not recapture. This preserves exactly two counted images per moment.
  IF v_verified_count = 1 THEN
    IF v_requester_upload_status = 'verified' THEN
      RAISE EXCEPTION 'capture_retry_only_missing_participant';
    END IF;

    UPDATE capture_images
    SET retry_scheduled_at = v_now + INTERVAL '5 seconds',
        upload_status = CASE
          WHEN upload_status = 'failed' THEN 'reserved'
          ELSE upload_status
        END
    WHERE attempt_id = v_attempt.id
      AND participant_id = v_participant_id
      AND upload_status != 'verified';

    UPDATE room_capture_sessions SET phase = 'countdown' WHERE id = v_session.id;
    RETURN true;
  END IF;

  -- With neither side verified, both participants safely retry a fresh attempt.
  UPDATE capture_attempts
  SET result_state = 'cancelled'
  WHERE id = v_attempt.id;

  SELECT
    COUNT(*) FILTER (WHERE member.is_ready)::integer,
    COUNT(*) FILTER (
      WHERE member.is_ready
        AND member.lease_expires_at > v_now
        AND member.active_webrtc_client_id IS NOT NULL
    )::integer
  INTO v_ready_count, v_live_lease_count
  FROM capture_session_members AS member
  WHERE member.session_id = v_session.id;

  IF v_ready_count != 2 OR v_live_lease_count != 2 THEN
    UPDATE room_capture_sessions SET phase = 'preparing' WHERE id = v_session.id;
    RETURN true;
  END IF;

  PERFORM schedule_next_synchronized_capture(v_session.id, v_now);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION get_synchronized_capture_server_time(
  p_room_code text,
  p_capability_hash text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM rooms AS room
    JOIN participants AS participant ON participant.room_id = room.id
    WHERE room.code = p_room_code
      AND room.expires_at > v_now
      AND participant.capability_hash = p_capability_hash
  ) THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION schedule_next_synchronized_capture(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION clear_capture_readiness_on_client_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_synchronized_capture_readiness(text, text, uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_synchronized_capture_upload(text, text, uuid, integer, uuid, integer, integer, bigint, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION restart_synchronized_capture_attempt(text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_synchronized_capture_server_time(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION set_synchronized_capture_readiness(text, text, uuid, integer, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION complete_synchronized_capture_upload(text, text, uuid, integer, uuid, integer, integer, bigint, timestamptz, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION restart_synchronized_capture_attempt(text, text, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION get_synchronized_capture_server_time(text, text)
  TO service_role;

COMMENT ON COLUMN capture_attempts.opaque_id IS
  'Non-authorizing attempt correlation ID safe for protected API responses and opaque Realtime hints';
COMMENT ON COLUMN capture_images.retry_scheduled_at IS
  'Optional server time for a missing participant-only recovery capture on the same attempt';
COMMENT ON FUNCTION set_synchronized_capture_readiness(text, text, uuid, integer, boolean) IS
  'Lease-bound readiness mutation that schedules exactly one shared attempt when both members are ready';
COMMENT ON FUNCTION complete_synchronized_capture_upload(text, text, uuid, integer, uuid, integer, integer, bigint, timestamptz, jsonb) IS
  'Idempotently verifies one participant image and advances only after the paired objects are verified';
