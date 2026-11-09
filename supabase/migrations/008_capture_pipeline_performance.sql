-- Synchronized capture pipeline performance tuning.
--
-- Keep the three-second visible countdown, but replace the unconditional
-- five-second lead with a bounded buffer derived from the latest completed
-- pair's measured clock RTT. No tables, policies, or storage access change.

CREATE OR REPLACE FUNCTION get_synchronized_capture_schedule_lead(
  p_session_id uuid
)
RETURNS interval
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_latest_attempt_id uuid;
  v_clock_round_trip_ms numeric;
  v_delivery_buffer_ms numeric;
BEGIN
  SELECT attempt.id
  INTO v_latest_attempt_id
  FROM capture_attempts AS attempt
  WHERE attempt.session_id = p_session_id
    AND attempt.result_state = 'complete'
  ORDER BY attempt.updated_at DESC
  LIMIT 1;

  SELECT MAX((image.capture_metadata ->> 'clockRoundTripMs')::numeric)
  INTO v_clock_round_trip_ms
  FROM capture_images AS image
  WHERE image.attempt_id = v_latest_attempt_id
    AND image.upload_status = 'verified'
    AND jsonb_typeof(image.capture_metadata -> 'clockRoundTripMs') = 'number';

  -- One second is the normal authoritative-state delivery allowance. High RTT
  -- sessions automatically retain up to the original five-second total lead.
  v_delivery_buffer_ms := GREATEST(
    1000,
    LEAST(2000, CEIL(COALESCE(v_clock_round_trip_ms, 0) * 2))
  );

  RETURN make_interval(secs => (3000 + v_delivery_buffer_ms) / 1000.0);
END;
$$;

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
    p_now + get_synchronized_capture_schedule_lead(p_session_id),
    'ready',
    'armed',
    'pending'
  )
  RETURNING id INTO v_attempt_id;

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

REVOKE ALL ON FUNCTION get_synchronized_capture_schedule_lead(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION schedule_next_synchronized_capture(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION get_synchronized_capture_schedule_lead(uuid) IS
  'Returns a bounded 4-5 second capture lead using the latest verified pair clock RTT';
