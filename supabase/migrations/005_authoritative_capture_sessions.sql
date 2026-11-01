-- Authoritative paired capture session foundation
--
-- This migration is additive. The legacy room_photo_sets flow remains intact.
-- All capture tables are closed to browser roles and are accessed only through
-- capability-protected application routes using the service role.

-- Composite foreign keys below make a participant's room membership part of
-- the database-enforced relationship, rather than an application convention.
ALTER TABLE participants
  ADD CONSTRAINT participants_room_id_id_unique UNIQUE (room_id, id);

-- ============================================================================
-- 1. CAPTURE SESSIONS
-- ============================================================================

CREATE TABLE room_capture_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opaque_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'camera_setup',
  revision integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT room_capture_sessions_valid_phase CHECK (
    phase IN (
      'camera_setup',
      'preparing',
      'countdown',
      'capturing',
      'selecting',
      'editing',
      'finalizing',
      'finalized'
    )
  ),
  CONSTRAINT room_capture_sessions_valid_revision CHECK (revision >= 1),
  CONSTRAINT room_capture_sessions_valid_timestamps CHECK (updated_at >= created_at),
  CONSTRAINT room_capture_sessions_room_id_id_unique UNIQUE (room_id, id)
);

-- Historical sessions can be retained later, but a room can have at most one
-- session designated as authoritative/current at a time.
CREATE UNIQUE INDEX idx_room_capture_sessions_one_current_per_room
  ON room_capture_sessions(room_id)
  WHERE is_current;

CREATE INDEX idx_room_capture_sessions_room_created
  ON room_capture_sessions(room_id, created_at DESC);

-- ============================================================================
-- 2. SESSION MEMBERS
-- ============================================================================

CREATE TABLE capture_session_members (
  session_id uuid NOT NULL,
  room_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  position text NOT NULL,
  is_ready boolean NOT NULL DEFAULT false,
  ready_at timestamptz,
  last_heartbeat_at timestamptz,
  active_client_generation integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT capture_session_members_pk PRIMARY KEY (session_id, participant_id),
  CONSTRAINT capture_session_members_unique_position UNIQUE (session_id, position),
  CONSTRAINT capture_session_members_valid_position CHECK (position IN ('A', 'B')),
  CONSTRAINT capture_session_members_valid_readiness CHECK (
    (is_ready AND ready_at IS NOT NULL)
    OR (NOT is_ready AND ready_at IS NULL)
  ),
  CONSTRAINT capture_session_members_valid_generation CHECK (
    active_client_generation >= 0
  ),
  CONSTRAINT capture_session_members_valid_lease CHECK (
    lease_expires_at IS NULL OR active_client_generation > 0
  ),
  CONSTRAINT capture_session_members_valid_timestamps CHECK (updated_at >= created_at),
  CONSTRAINT capture_session_members_session_room_fk
    FOREIGN KEY (room_id, session_id)
    REFERENCES room_capture_sessions(room_id, id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT capture_session_members_participant_room_fk
    FOREIGN KEY (room_id, participant_id)
    REFERENCES participants(room_id, id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_capture_session_members_participant
  ON capture_session_members(participant_id, session_id);

CREATE INDEX idx_capture_session_members_lease
  ON capture_session_members(lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

-- ============================================================================
-- 3. LOGICAL CAPTURE MOMENTS
-- ============================================================================

CREATE TABLE capture_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES room_capture_sessions(id) ON DELETE CASCADE,
  capture_index smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT capture_moments_valid_index CHECK (capture_index BETWEEN 1 AND 6),
  CONSTRAINT capture_moments_unique_session_index UNIQUE (session_id, capture_index),
  CONSTRAINT capture_moments_session_id_id_unique UNIQUE (session_id, id)
);

-- ============================================================================
-- 4. RETRYABLE CAPTURE ATTEMPTS
-- ============================================================================

CREATE TABLE capture_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  moment_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  generation integer NOT NULL,
  scheduled_capture_at timestamptz NOT NULL,
  preparation_state text NOT NULL DEFAULT 'pending',
  armed_state text NOT NULL DEFAULT 'pending',
  result_state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT capture_attempts_valid_attempt_number CHECK (attempt_number >= 1),
  CONSTRAINT capture_attempts_valid_generation CHECK (generation >= 1),
  CONSTRAINT capture_attempts_valid_preparation_state CHECK (
    preparation_state IN ('pending', 'preparing', 'ready', 'failed')
  ),
  CONSTRAINT capture_attempts_valid_armed_state CHECK (
    armed_state IN ('pending', 'armed', 'released')
  ),
  CONSTRAINT capture_attempts_valid_result_state CHECK (
    result_state IN ('pending', 'partial', 'complete', 'failed', 'cancelled')
  ),
  CONSTRAINT capture_attempts_valid_timestamps CHECK (updated_at >= created_at),
  CONSTRAINT capture_attempts_unique_moment_attempt UNIQUE (moment_id, attempt_number),
  CONSTRAINT capture_attempts_session_id_id_unique UNIQUE (session_id, id),
  CONSTRAINT capture_attempts_moment_session_fk
    FOREIGN KEY (session_id, moment_id)
    REFERENCES capture_moments(session_id, id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_capture_attempts_session_schedule
  ON capture_attempts(session_id, scheduled_capture_at);

-- ============================================================================
-- 5. PAIRED CAPTURE IMAGES
-- ============================================================================

CREATE TABLE capture_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,
  upload_status text NOT NULL DEFAULT 'reserved',
  width_px integer,
  height_px integer,
  file_size_bytes bigint,
  captured_at timestamptz,
  capture_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT capture_images_unique_attempt_participant UNIQUE (attempt_id, participant_id),
  CONSTRAINT capture_images_valid_upload_status CHECK (
    upload_status IN ('reserved', 'uploading', 'uploaded', 'verified', 'failed')
  ),
  CONSTRAINT capture_images_valid_dimensions CHECK (
    (width_px IS NULL AND height_px IS NULL)
    OR (
      width_px IS NOT NULL
      AND height_px IS NOT NULL
      AND width_px > 0
      AND height_px > 0
    )
  ),
  CONSTRAINT capture_images_valid_file_size CHECK (
    file_size_bytes IS NULL
    OR (file_size_bytes > 0 AND file_size_bytes <= 10485760)
  ),
  CONSTRAINT capture_images_valid_metadata CHECK (
    jsonb_typeof(capture_metadata) = 'object'
  ),
  CONSTRAINT capture_images_verified_has_metadata CHECK (
    upload_status != 'verified'
    OR (
      width_px IS NOT NULL
      AND height_px IS NOT NULL
      AND file_size_bytes IS NOT NULL
      AND captured_at IS NOT NULL
    )
  ),
  CONSTRAINT capture_images_valid_timestamps CHECK (updated_at >= created_at),
  CONSTRAINT capture_images_attempt_session_fk
    FOREIGN KEY (session_id, attempt_id)
    REFERENCES capture_attempts(session_id, id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT capture_images_member_session_fk
    FOREIGN KEY (session_id, participant_id)
    REFERENCES capture_session_members(session_id, participant_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_capture_images_session_attempt
  ON capture_images(session_id, attempt_id);

CREATE INDEX idx_capture_images_incomplete_uploads
  ON capture_images(created_at)
  WHERE upload_status NOT IN ('verified', 'failed');

-- ============================================================================
-- 6. SERVER-MAINTAINED IDENTITY, REVISION, AND STORAGE PATHS
-- ============================================================================

CREATE OR REPLACE FUNCTION maintain_room_capture_session_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.opaque_id IS DISTINCT FROM OLD.opaque_id
    OR NEW.room_id IS DISTINCT FROM OLD.room_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'capture_session_identity_immutable';
  END IF;

  NEW.revision := OLD.revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER room_capture_sessions_maintain_update
BEFORE UPDATE ON room_capture_sessions
FOR EACH ROW
EXECUTE FUNCTION maintain_room_capture_session_update();

CREATE OR REPLACE FUNCTION maintain_capture_session_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_presence_key text;
  v_expected_position text;
BEGIN
  SELECT participant.presence_key
  INTO v_presence_key
  FROM participants AS participant
  WHERE participant.room_id = NEW.room_id
    AND participant.id = NEW.participant_id;

  v_expected_position := CASE v_presence_key
    WHEN 'participant-1' THEN 'A'
    WHEN 'participant-2' THEN 'B'
  END;

  IF v_expected_position IS NULL OR NEW.position != v_expected_position THEN
    RAISE EXCEPTION 'capture_member_position_invalid';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.room_id IS DISTINCT FROM OLD.room_id
      OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
      OR NEW.position IS DISTINCT FROM OLD.position
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'capture_member_identity_immutable';
    END IF;

    IF NEW.active_client_generation < OLD.active_client_generation THEN
      RAISE EXCEPTION 'capture_member_generation_cannot_decrease';
    END IF;

    NEW.updated_at := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER capture_session_members_maintain
BEFORE INSERT OR UPDATE ON capture_session_members
FOR EACH ROW
EXECUTE FUNCTION maintain_capture_session_member();

CREATE OR REPLACE FUNCTION maintain_capture_attempt_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.moment_id IS DISTINCT FROM OLD.moment_id
    OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
    OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.scheduled_capture_at IS DISTINCT FROM OLD.scheduled_capture_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'capture_attempt_identity_immutable';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER capture_attempts_maintain_update
BEFORE UPDATE ON capture_attempts
FOR EACH ROW
EXECUTE FUNCTION maintain_capture_attempt_update();

CREATE OR REPLACE FUNCTION maintain_capture_image()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_opaque_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT capture_session.opaque_id
    INTO v_session_opaque_id
    FROM room_capture_sessions AS capture_session
    WHERE capture_session.id = NEW.session_id;

    IF v_session_opaque_id IS NULL THEN
      RAISE EXCEPTION 'capture_session_not_found';
    END IF;

    -- Callers cannot choose object locations. A random object key avoids
    -- exposing room, participant, attempt, or image row identifiers.
    NEW.storage_path := format(
      'capture-sessions/%s/%s.jpg',
      v_session_opaque_id,
      gen_random_uuid()
    );
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
      OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'capture_image_identity_immutable';
    END IF;

    NEW.storage_path := OLD.storage_path;
    NEW.updated_at := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER capture_images_maintain
BEFORE INSERT OR UPDATE ON capture_images
FOR EACH ROW
EXECUTE FUNCTION maintain_capture_image();

-- ============================================================================
-- 7. DEFERRED EXACT-CARDINALITY AND COMPLETE-PAIR INTEGRITY
-- ============================================================================

CREATE OR REPLACE FUNCTION assert_capture_session_shape(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member_count integer;
  v_position_a_count integer;
  v_position_b_count integer;
  v_moment_count integer;
BEGIN
  -- Cascading deletion removes the parent before deferred checks run.
  IF NOT EXISTS (
    SELECT 1
    FROM room_capture_sessions
    WHERE id = p_session_id
  ) THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE position = 'A')::integer,
    COUNT(*) FILTER (WHERE position = 'B')::integer
  INTO v_member_count, v_position_a_count, v_position_b_count
  FROM capture_session_members
  WHERE session_id = p_session_id;

  IF v_member_count != 2
    OR v_position_a_count != 1
    OR v_position_b_count != 1
  THEN
    RAISE EXCEPTION 'capture_session_requires_exactly_two_members'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_moment_count
  FROM capture_moments
  WHERE session_id = p_session_id;

  -- The index range check and unique(session_id, capture_index), together with
  -- this count, mean every session has exactly indices 1 through 6.
  IF v_moment_count != 6 THEN
    RAISE EXCEPTION 'capture_session_requires_exactly_six_moments'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION check_capture_session_shape_from_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM assert_capture_session_shape(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION check_capture_session_shape_from_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM assert_capture_session_shape(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END
  );
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER room_capture_sessions_exact_shape
AFTER INSERT OR UPDATE OR DELETE ON room_capture_sessions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_capture_session_shape_from_session();

CREATE CONSTRAINT TRIGGER capture_session_members_exact_shape
AFTER INSERT OR UPDATE OR DELETE ON capture_session_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_capture_session_shape_from_child();

CREATE CONSTRAINT TRIGGER capture_moments_exact_shape
AFTER INSERT OR UPDATE OR DELETE ON capture_moments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_capture_session_shape_from_child();

CREATE OR REPLACE FUNCTION assert_capture_attempt_complete_pair(p_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result_state text;
  v_image_count integer;
  v_verified_count integer;
BEGIN
  SELECT capture_attempt.result_state
  INTO v_result_state
  FROM capture_attempts AS capture_attempt
  WHERE capture_attempt.id = p_attempt_id;

  IF v_result_state IS NULL OR v_result_state != 'complete' THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE upload_status = 'verified')::integer
  INTO v_image_count, v_verified_count
  FROM capture_images
  WHERE attempt_id = p_attempt_id;

  -- Session membership has exactly A and B, and the image uniqueness/FKs limit
  -- this to one image for each of those two members on this exact attempt.
  IF v_image_count != 2 OR v_verified_count != 2 THEN
    RAISE EXCEPTION 'complete_capture_attempt_requires_verified_pair'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION check_capture_attempt_pair_from_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM assert_capture_attempt_complete_pair(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION check_capture_attempt_pair_from_image()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM assert_capture_attempt_complete_pair(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.attempt_id ELSE NEW.attempt_id END
  );
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER capture_attempts_complete_pair
AFTER INSERT OR UPDATE OR DELETE ON capture_attempts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_capture_attempt_pair_from_attempt();

CREATE CONSTRAINT TRIGGER capture_images_complete_pair
AFTER INSERT OR UPDATE OR DELETE ON capture_images
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_capture_attempt_pair_from_image();

-- ============================================================================
-- 8. ATOMIC, CAPABILITY-AUTHORIZED SESSION CREATION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_or_create_room_capture_session(
  p_room_code text,
  p_capability_hash text
)
RETURNS TABLE (
  capture_session_id uuid,
  opaque_session_id uuid,
  capture_phase text,
  capture_revision integer,
  capture_created_at timestamptz,
  capture_updated_at timestamptz,
  participant_position text,
  was_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_requesting_participant participants%ROWTYPE;
  v_session room_capture_sessions%ROWTYPE;
  v_participant_count integer;
  v_participant_one_count integer;
  v_participant_two_count integer;
  v_position text;
  v_was_created boolean := false;
BEGIN
  -- The room-row lock serializes all concurrent creation requests for a room.
  SELECT room.*
  INTO v_room
  FROM rooms AS room
  WHERE room.code = p_room_code
  FOR UPDATE;

  IF v_room.id IS NULL OR v_room.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  SELECT participant.*
  INTO v_requesting_participant
  FROM participants AS participant
  WHERE participant.room_id = v_room.id
    AND participant.capability_hash = p_capability_hash;

  IF v_requesting_participant.id IS NULL THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  IF v_room.state = 'ended' THEN
    RAISE EXCEPTION 'room_ended';
  END IF;

  IF v_room.state != 'active' THEN
    RAISE EXCEPTION 'room_not_capture_ready';
  END IF;

  SELECT capture_session.*
  INTO v_session
  FROM room_capture_sessions AS capture_session
  WHERE capture_session.room_id = v_room.id
    AND capture_session.is_current;

  IF v_session.id IS NULL THEN
    SELECT
      COUNT(*)::integer,
      COUNT(*) FILTER (WHERE presence_key = 'participant-1')::integer,
      COUNT(*) FILTER (WHERE presence_key = 'participant-2')::integer
    INTO v_participant_count, v_participant_one_count, v_participant_two_count
    FROM participants
    WHERE room_id = v_room.id;

    IF v_room.participant_count != 2
      OR v_participant_count != 2
      OR v_participant_one_count != 1
      OR v_participant_two_count != 1
    THEN
      RAISE EXCEPTION 'room_participants_invalid';
    END IF;

    INSERT INTO room_capture_sessions (room_id)
    VALUES (v_room.id)
    RETURNING * INTO v_session;

    INSERT INTO capture_session_members (
      session_id,
      room_id,
      participant_id,
      position
    )
    SELECT
      v_session.id,
      participant.room_id,
      participant.id,
      CASE participant.presence_key
        WHEN 'participant-1' THEN 'A'
        WHEN 'participant-2' THEN 'B'
      END
    FROM participants AS participant
    WHERE participant.room_id = v_room.id;

    INSERT INTO capture_moments (session_id, capture_index)
    SELECT v_session.id, generated.capture_index::smallint
    FROM generate_series(1, 6) AS generated(capture_index);

    UPDATE rooms
    SET last_activity_at = clock_timestamp()
    WHERE id = v_room.id;

    v_was_created := true;
  END IF;

  SELECT member.position
  INTO v_position
  FROM capture_session_members AS member
  WHERE member.session_id = v_session.id
    AND member.participant_id = v_requesting_participant.id;

  IF v_position IS NULL THEN
    RAISE EXCEPTION 'capture_session_membership_invalid';
  END IF;

  RETURN QUERY SELECT
    v_session.id,
    v_session.opaque_id,
    v_session.phase,
    v_session.revision,
    v_session.created_at,
    v_session.updated_at,
    v_position,
    v_was_created;
END;
$$;

-- ============================================================================
-- 9. CLOSED RLS AND PRIVILEGES
-- ============================================================================

ALTER TABLE room_capture_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_session_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_images ENABLE ROW LEVEL SECURITY;

-- No policies are intentionally created. Browser roles cannot read or mutate
-- these tables directly; service-role operations remain server-side.
REVOKE ALL ON TABLE room_capture_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE capture_session_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE capture_moments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE capture_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE capture_images FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE room_capture_sessions TO service_role;
GRANT ALL ON TABLE capture_session_members TO service_role;
GRANT ALL ON TABLE capture_moments TO service_role;
GRANT ALL ON TABLE capture_attempts TO service_role;
GRANT ALL ON TABLE capture_images TO service_role;

REVOKE ALL ON FUNCTION maintain_room_capture_session_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION maintain_capture_session_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION maintain_capture_attempt_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION maintain_capture_image() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION assert_capture_session_shape(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION check_capture_session_shape_from_session() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION check_capture_session_shape_from_child() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION assert_capture_attempt_complete_pair(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION check_capture_attempt_pair_from_attempt() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION check_capture_attempt_pair_from_image() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_or_create_room_capture_session(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_room_capture_session(text, text) TO service_role;

-- ============================================================================
-- 10. DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE room_capture_sessions IS
  'Authoritative synchronized paired-capture lifecycle, independent of room lifecycle';
COMMENT ON COLUMN room_capture_sessions.id IS
  'Internal relational identifier; never serialized to clients';
COMMENT ON COLUMN room_capture_sessions.opaque_id IS
  'Server-generated non-authorizing correlation identifier safe for API responses';
COMMENT ON COLUMN room_capture_sessions.phase IS
  'Server-controlled capture phase; does not alter rooms.state';
COMMENT ON COLUMN room_capture_sessions.revision IS
  'Server-maintained monotonic revision incremented on every session update';

COMMENT ON TABLE capture_session_members IS
  'Exactly two room participants assigned stable A/B capture positions';
COMMENT ON COLUMN capture_session_members.active_client_generation IS
  'Monotonic generation used to reject commands from superseded client instances';
COMMENT ON COLUMN capture_session_members.lease_expires_at IS
  'Optional server-issued active-client lease expiration';

COMMENT ON TABLE capture_moments IS
  'Exactly six stable logical capture moments per authoritative session';
COMMENT ON TABLE capture_attempts IS
  'Retryable scheduled attempts belonging to one logical capture moment';
COMMENT ON COLUMN capture_attempts.scheduled_capture_at IS
  'Authoritative server-generated capture timestamp; browser roles cannot insert attempts';

COMMENT ON TABLE capture_images IS
  'One private JPEG image reservation per participant and capture attempt';
COMMENT ON COLUMN capture_images.storage_path IS
  'Database-derived path in the existing private room-photos bucket';
COMMENT ON COLUMN capture_images.upload_status IS
  'Only verified images count toward a complete paired capture';

COMMENT ON FUNCTION get_or_create_room_capture_session(text, text) IS
  'Capability-authorized, expiration-aware, concurrency-safe creation or retrieval of a room current capture session';
