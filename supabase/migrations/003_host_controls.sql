-- Host Controls V1
-- Persists creator ownership, adds an ended lifecycle state, and keeps all
-- sensitive room transitions behind service-role-only database functions.

-- Give every participant a stable, server-assigned room-local identity. The
-- one-time ordering below only migrates existing rows; all new identities are
-- assigned explicitly by the trusted create/join functions.
ALTER TABLE participants ADD COLUMN presence_key text;

WITH ranked_participants AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY room_id
      ORDER BY joined_at ASC, id ASC
    ) AS participant_number
  FROM participants
)
UPDATE participants AS participant
SET presence_key = CASE ranked.participant_number
  WHEN 1 THEN 'participant-1'
  WHEN 2 THEN 'participant-2'
END
FROM ranked_participants AS ranked
WHERE participant.id = ranked.id;

ALTER TABLE participants
  ALTER COLUMN presence_key SET NOT NULL,
  ADD CONSTRAINT valid_presence_key
    CHECK (presence_key IN ('participant-1', 'participant-2')),
  ADD CONSTRAINT unique_room_presence_key UNIQUE (room_id, presence_key);

ALTER TABLE rooms
  ADD COLUMN host_participant_id uuid,
  ADD COLUMN ended_at timestamptz;

UPDATE rooms AS room
SET host_participant_id = participant.id
FROM participants AS participant
WHERE participant.room_id = room.id
  AND participant.presence_key = 'participant-1';

ALTER TABLE rooms
  ALTER COLUMN host_participant_id SET NOT NULL,
  ADD CONSTRAINT rooms_host_participant_fk
    FOREIGN KEY (host_participant_id)
    REFERENCES participants(id)
    DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT valid_state,
  ADD CONSTRAINT valid_state
    CHECK (state IN ('waiting', 'active', 'completed', 'expired', 'ended')),
  ADD CONSTRAINT ended_room_has_timestamp
    CHECK (
      (state = 'ended' AND ended_at IS NOT NULL)
      OR (state != 'ended' AND ended_at IS NULL)
    );

-- Recreate room creation so the room points at its creator in the same atomic
-- transaction. The deferred foreign key permits the participant row to be
-- inserted immediately after the room row.
CREATE OR REPLACE FUNCTION create_room(
  p_room_code text,
  p_capability_hash text
)
RETURNS TABLE (
  room_id uuid,
  participant_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id uuid := gen_random_uuid();
  v_participant_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO rooms (
    id,
    code,
    participant_count,
    max_participants,
    state,
    expires_at,
    host_participant_id
  )
  VALUES (
    v_room_id,
    p_room_code,
    1,
    2,
    'waiting',
    NOW() + INTERVAL '30 minutes',
    v_participant_id
  );

  INSERT INTO participants (
    id,
    room_id,
    capability_hash,
    presence_key
  )
  VALUES (
    v_participant_id,
    v_room_id,
    p_capability_hash,
    'participant-1'
  );

  RETURN QUERY SELECT v_room_id, v_participant_id;
END;
$$;

REVOKE ALL ON FUNCTION create_room(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_room(text, text) FROM anon;
REVOKE ALL ON FUNCTION create_room(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_room(text, text) TO service_role;

-- Recreate joining so the second participant also receives a durable identity.
CREATE OR REPLACE FUNCTION join_room(
  p_room_code text,
  p_capability_hash text
)
RETURNS TABLE (
  room_id uuid,
  room_code text,
  participant_id uuid,
  room_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id uuid;
  v_room_code text;
  v_participant_id uuid;
  v_new_state text;
  v_new_count integer;
BEGIN
  UPDATE rooms
  SET participant_count = participant_count + 1,
      last_activity_at = NOW()
  WHERE code = p_room_code
    AND state = 'waiting'
    AND participant_count < max_participants
    AND expires_at > NOW()
  RETURNING id, code, participant_count
  INTO v_room_id, v_room_code, v_new_count;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'room_not_joinable'
      USING HINT = 'Room does not exist, is full, expired, ended, or already active';
  END IF;

  INSERT INTO participants (room_id, capability_hash, presence_key)
  VALUES (v_room_id, p_capability_hash, 'participant-2')
  RETURNING id INTO v_participant_id;

  IF v_new_count = 2 THEN
    UPDATE rooms
    SET state = 'active'
    WHERE id = v_room_id
      AND state = 'waiting'
    RETURNING state INTO v_new_state;
  ELSE
    v_new_state := 'waiting';
  END IF;

  RETURN QUERY SELECT v_room_id, v_room_code, v_participant_id, v_new_state;
END;
$$;

REVOKE ALL ON FUNCTION join_room(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION join_room(text, text) FROM anon;
REVOKE ALL ON FUNCTION join_room(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION join_room(text, text) TO service_role;

-- Atomically authorize and end a room. A repeated request from the same host
-- returns the original ended_at timestamp without mutating the room again.
CREATE OR REPLACE FUNCTION end_room(
  p_room_code text,
  p_capability_hash text
)
RETURNS TABLE (
  room_state text,
  room_ended_at timestamptz,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_participant_id uuid;
  v_ended_at timestamptz;
BEGIN
  SELECT *
  INTO v_room
  FROM rooms
  WHERE code = p_room_code
    AND expires_at > NOW()
  FOR UPDATE;

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  SELECT id
  INTO v_participant_id
  FROM participants
  WHERE room_id = v_room.id
    AND capability_hash = p_capability_hash;

  IF v_participant_id IS NULL THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  IF v_participant_id != v_room.host_participant_id THEN
    RAISE EXCEPTION 'host_required';
  END IF;

  IF v_room.state = 'ended' THEN
    RETURN QUERY SELECT 'ended'::text, v_room.ended_at, false;
    RETURN;
  END IF;

  IF v_room.state NOT IN ('waiting', 'active') THEN
    RAISE EXCEPTION 'room_not_endable';
  END IF;

  UPDATE rooms
  SET state = 'ended',
      ended_at = NOW(),
      last_activity_at = NOW()
  WHERE id = v_room.id
  RETURNING ended_at INTO v_ended_at;

  RETURN QUERY SELECT 'ended'::text, v_ended_at, true;
END;
$$;

REVOKE ALL ON FUNCTION end_room(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION end_room(text, text) FROM anon;
REVOKE ALL ON FUNCTION end_room(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION end_room(text, text) TO service_role;

-- Defense in depth for races between upload reservation/completion and ending
-- the room. Storage objects may finish transferring, but an ended room can
-- never create or publish a photo-set manifest.
CREATE OR REPLACE FUNCTION reject_ended_room_photo_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_state text;
BEGIN
  SELECT state INTO v_room_state
  FROM rooms
  WHERE id = NEW.room_id;

  IF v_room_state = 'ended' THEN
    RAISE EXCEPTION 'room_ended';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER room_photo_sets_reject_ended_room
BEFORE INSERT OR UPDATE ON room_photo_sets
FOR EACH ROW
EXECUTE FUNCTION reject_ended_room_photo_mutation();

REVOKE ALL ON FUNCTION reject_ended_room_photo_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_ended_room_photo_mutation() FROM anon;
REVOKE ALL ON FUNCTION reject_ended_room_photo_mutation() FROM authenticated;

COMMENT ON COLUMN rooms.host_participant_id IS
  'Immutable participant ID for the room creator; authoritative host identity';
COMMENT ON COLUMN rooms.ended_at IS
  'Server timestamp set exactly once when the host ends the room';
COMMENT ON COLUMN participants.presence_key IS
  'Stable server-assigned room-local identity used by Realtime presence';
COMMENT ON FUNCTION end_room(text, text) IS
  'Idempotently ends a room after capability and immutable host authorization';
