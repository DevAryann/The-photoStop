-- Milestone 2: secure, capability-authorized WebRTC signaling inbox
--
-- SDP and ICE payloads are stored only in closed, service-role tables. Browser
-- roles never query these rows directly; Supabase Realtime carries only an
-- opaque inbox revision hint.

-- The Milestone 1 member generation is the authoritative single-client lease.
-- A random per-document client ID distinguishes tabs without becoming an
-- authorization credential. Sequence numbers reset whenever the generation is
-- advanced.
ALTER TABLE capture_session_members
  ADD COLUMN active_webrtc_client_id uuid,
  ADD COLUMN last_webrtc_signal_sequence bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT capture_session_members_valid_webrtc_sequence
    CHECK (last_webrtc_signal_sequence >= 0);

-- One monotonically increasing revision per protected recipient inbox.
CREATE TABLE webrtc_signaling_inboxes (
  session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT webrtc_signaling_inboxes_pk
    PRIMARY KEY (session_id, participant_id),
  CONSTRAINT webrtc_signaling_inboxes_valid_revision CHECK (revision >= 0),
  CONSTRAINT webrtc_signaling_inboxes_member_fk
    FOREIGN KEY (session_id, participant_id)
    REFERENCES capture_session_members(session_id, participant_id)
    ON DELETE CASCADE
);

-- Each row is addressed to exactly one server-derived recipient. opaque_id is
-- safe to return as an acknowledgement handle; relational IDs remain internal.
CREATE TABLE webrtc_signaling_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  opaque_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  sender_participant_id uuid NOT NULL,
  recipient_participant_id uuid NOT NULL,
  sender_generation integer NOT NULL,
  sequence bigint NOT NULL,
  negotiation_id uuid NOT NULL,
  message_type text NOT NULL,
  payload jsonb NOT NULL,
  inbox_revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  acknowledged_at timestamptz,

  CONSTRAINT webrtc_signaling_messages_distinct_participants
    CHECK (sender_participant_id != recipient_participant_id),
  CONSTRAINT webrtc_signaling_messages_valid_generation
    CHECK (sender_generation > 0),
  CONSTRAINT webrtc_signaling_messages_valid_sequence CHECK (sequence > 0),
  CONSTRAINT webrtc_signaling_messages_valid_revision
    CHECK (inbox_revision > 0),
  CONSTRAINT webrtc_signaling_messages_valid_type
    CHECK (message_type IN ('offer', 'answer', 'ice', 'restart')),
  CONSTRAINT webrtc_signaling_messages_payload_object
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT webrtc_signaling_messages_payload_limit
    CHECK (octet_length(payload::text) <= 98304),
  CONSTRAINT webrtc_signaling_messages_valid_expiry
    CHECK (
      expires_at > created_at
      AND expires_at <= created_at + INTERVAL '5 minutes'
    ),
  CONSTRAINT webrtc_signaling_messages_valid_ack
    CHECK (acknowledged_at IS NULL OR acknowledged_at >= created_at),
  CONSTRAINT webrtc_signaling_messages_sender_fk
    FOREIGN KEY (session_id, sender_participant_id)
    REFERENCES capture_session_members(session_id, participant_id)
    ON DELETE CASCADE,
  CONSTRAINT webrtc_signaling_messages_recipient_fk
    FOREIGN KEY (session_id, recipient_participant_id)
    REFERENCES capture_session_members(session_id, participant_id)
    ON DELETE CASCADE,
  CONSTRAINT webrtc_signaling_messages_deduplicate
    UNIQUE (session_id, sender_participant_id, sender_generation, sequence),
  CONSTRAINT webrtc_signaling_messages_revision_unique
    UNIQUE (session_id, recipient_participant_id, inbox_revision)
);

CREATE INDEX idx_webrtc_signaling_messages_unread
  ON webrtc_signaling_messages(
    session_id,
    recipient_participant_id,
    inbox_revision
  )
  WHERE acknowledged_at IS NULL;

CREATE INDEX idx_webrtc_signaling_messages_expiry
  ON webrtc_signaling_messages(expires_at);

-- Claim or renew the one active WebRTC client for this participant. A force
-- claim always advances the generation, invalidating every request from the
-- previous tab. The room and participant are derived from the capability hash.
CREATE OR REPLACE FUNCTION claim_webrtc_client(
  p_room_code text,
  p_capability_hash text,
  p_client_id uuid,
  p_force boolean DEFAULT false
)
RETURNS TABLE (
  client_generation integer,
  client_lease_expires_at timestamptz,
  last_signal_sequence bigint,
  participant_position text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_participant_id uuid;
  v_session_id uuid;
  v_member capture_session_members%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_generation integer;
  v_lease_expires_at timestamptz;
  v_last_sequence bigint;
BEGIN
  SELECT room.*
  INTO v_room
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

  SELECT participant.id
  INTO v_participant_id
  FROM participants AS participant
  WHERE participant.room_id = v_room.id
    AND participant.capability_hash = p_capability_hash;

  IF v_participant_id IS NULL THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  SELECT capture_session.id
  INTO v_session_id
  FROM room_capture_sessions AS capture_session
  WHERE capture_session.room_id = v_room.id
    AND capture_session.is_current;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'capture_session_required';
  END IF;

  SELECT member.*
  INTO v_member
  FROM capture_session_members AS member
  WHERE member.session_id = v_session_id
    AND member.participant_id = v_participant_id
  FOR UPDATE;

  IF v_member.participant_id IS NULL THEN
    RAISE EXCEPTION 'capture_session_membership_invalid';
  END IF;

  IF NOT p_force
    AND v_member.lease_expires_at > v_now
    AND v_member.active_webrtc_client_id IS DISTINCT FROM p_client_id
  THEN
    RAISE EXCEPTION 'webrtc_client_lease_active';
  END IF;

  IF NOT p_force
    AND v_member.lease_expires_at > v_now
    AND v_member.active_webrtc_client_id = p_client_id
  THEN
    UPDATE capture_session_members AS member
    SET lease_expires_at = v_now + INTERVAL '45 seconds',
        last_heartbeat_at = v_now
    WHERE member.session_id = v_session_id
      AND member.participant_id = v_participant_id
    RETURNING
      member.active_client_generation,
      member.lease_expires_at,
      member.last_webrtc_signal_sequence
    INTO v_generation, v_lease_expires_at, v_last_sequence;
  ELSE
    IF v_member.active_client_generation >= 2147483647 THEN
      RAISE EXCEPTION 'webrtc_generation_exhausted';
    END IF;

    UPDATE capture_session_members AS member
    SET active_client_generation = v_member.active_client_generation + 1,
        active_webrtc_client_id = p_client_id,
        last_webrtc_signal_sequence = 0,
        lease_expires_at = v_now + INTERVAL '45 seconds',
        last_heartbeat_at = v_now
    WHERE member.session_id = v_session_id
      AND member.participant_id = v_participant_id
    RETURNING
      member.active_client_generation,
      member.lease_expires_at,
      member.last_webrtc_signal_sequence
    INTO v_generation, v_lease_expires_at, v_last_sequence;
  END IF;

  INSERT INTO webrtc_signaling_inboxes (session_id, participant_id)
  SELECT member.session_id, member.participant_id
  FROM capture_session_members AS member
  WHERE member.session_id = v_session_id
  ON CONFLICT (session_id, participant_id) DO NOTHING;

  DELETE FROM webrtc_signaling_messages AS message
  WHERE message.session_id = v_session_id
    AND message.expires_at <= v_now;

  RETURN QUERY SELECT
    v_generation,
    v_lease_expires_at,
    v_last_sequence,
    v_member.position;
END;
$$;

-- Heartbeats extend only the exact active client generation. Stale tabs cannot
-- revive their lease after another tab advances the generation.
CREATE OR REPLACE FUNCTION renew_webrtc_client(
  p_room_code text,
  p_capability_hash text,
  p_client_id uuid,
  p_generation integer
)
RETURNS TABLE (client_lease_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_participant_id uuid;
  v_session_id uuid;
  v_lease_expires_at timestamptz;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT room.*
  INTO v_room
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

  SELECT participant.id
  INTO v_participant_id
  FROM participants AS participant
  WHERE participant.room_id = v_room.id
    AND participant.capability_hash = p_capability_hash;

  SELECT capture_session.id
  INTO v_session_id
  FROM room_capture_sessions AS capture_session
  WHERE capture_session.room_id = v_room.id
    AND capture_session.is_current;

  UPDATE capture_session_members AS member
  SET lease_expires_at = v_now + INTERVAL '45 seconds',
      last_heartbeat_at = v_now
  WHERE member.session_id = v_session_id
    AND member.participant_id = v_participant_id
    AND member.active_webrtc_client_id = p_client_id
    AND member.active_client_generation = p_generation
    AND member.lease_expires_at > v_now
  RETURNING member.lease_expires_at INTO v_lease_expires_at;

  IF v_lease_expires_at IS NULL THEN
    RAISE EXCEPTION 'webrtc_client_lease_lost';
  END IF;

  RETURN QUERY SELECT v_lease_expires_at;
END;
$$;

-- Cleanup is idempotent and never clears a newer client's lease.
CREATE OR REPLACE FUNCTION release_webrtc_client(
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
  v_room_id uuid;
  v_participant_id uuid;
  v_session_id uuid;
  v_released_id uuid;
BEGIN
  SELECT room.id
  INTO v_room_id
  FROM rooms AS room
  WHERE room.code = p_room_code;

  SELECT participant.id
  INTO v_participant_id
  FROM participants AS participant
  WHERE participant.room_id = v_room_id
    AND participant.capability_hash = p_capability_hash;

  IF v_room_id IS NULL OR v_participant_id IS NULL THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  SELECT capture_session.id
  INTO v_session_id
  FROM room_capture_sessions AS capture_session
  WHERE capture_session.room_id = v_room_id
    AND capture_session.is_current;

  UPDATE capture_session_members AS member
  SET active_webrtc_client_id = NULL,
      lease_expires_at = NULL,
      last_heartbeat_at = clock_timestamp()
  WHERE member.session_id = v_session_id
    AND member.participant_id = v_participant_id
    AND member.active_webrtc_client_id = p_client_id
    AND member.active_client_generation = p_generation
  RETURNING member.participant_id INTO v_released_id;

  RETURN v_released_id IS NOT NULL;
END;
$$;

-- Atomically validate the active lease, enforce sequence ordering/rate limits,
-- derive the other member as recipient, increment that inbox revision, and
-- enqueue one expiring message. Retrying an identical sequence is idempotent.
CREATE OR REPLACE FUNCTION enqueue_webrtc_signal(
  p_room_code text,
  p_capability_hash text,
  p_client_id uuid,
  p_generation integer,
  p_sequence bigint,
  p_negotiation_id uuid,
  p_message_type text,
  p_payload jsonb
)
RETURNS TABLE (
  message_opaque_id uuid,
  recipient_inbox_revision bigint,
  message_expires_at timestamptz,
  was_deduplicated boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_sender_id uuid;
  v_recipient_id uuid;
  v_session_id uuid;
  v_member capture_session_members%ROWTYPE;
  v_existing webrtc_signaling_messages%ROWTYPE;
  v_revision bigint;
  v_message_id uuid;
  v_expires_at timestamptz;
  v_recent_count integer;
  v_pending_count integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_sequence <= 0
    OR p_generation <= 0
    OR p_message_type NOT IN ('offer', 'answer', 'ice', 'restart')
    OR jsonb_typeof(p_payload) != 'object'
    OR octet_length(p_payload::text) > 98304
  THEN
    RAISE EXCEPTION 'webrtc_signal_invalid';
  END IF;

  SELECT room.*
  INTO v_room
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

  SELECT participant.id
  INTO v_sender_id
  FROM participants AS participant
  WHERE participant.room_id = v_room.id
    AND participant.capability_hash = p_capability_hash;

  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'room_access_denied';
  END IF;

  SELECT capture_session.id
  INTO v_session_id
  FROM room_capture_sessions AS capture_session
  WHERE capture_session.room_id = v_room.id
    AND capture_session.is_current;

  SELECT member.*
  INTO v_member
  FROM capture_session_members AS member
  WHERE member.session_id = v_session_id
    AND member.participant_id = v_sender_id
  FOR UPDATE;

  IF v_member.participant_id IS NULL
    OR v_member.active_webrtc_client_id IS DISTINCT FROM p_client_id
    OR v_member.active_client_generation != p_generation
    OR v_member.lease_expires_at <= v_now
  THEN
    RAISE EXCEPTION 'webrtc_client_lease_lost';
  END IF;

  SELECT message.*
  INTO v_existing
  FROM webrtc_signaling_messages AS message
  WHERE message.session_id = v_session_id
    AND message.sender_participant_id = v_sender_id
    AND message.sender_generation = p_generation
    AND message.sequence = p_sequence;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.negotiation_id != p_negotiation_id
      OR v_existing.message_type != p_message_type
      OR v_existing.payload != p_payload
    THEN
      RAISE EXCEPTION 'webrtc_signal_sequence_conflict';
    END IF;

    UPDATE capture_session_members AS member
    SET lease_expires_at = v_now + INTERVAL '45 seconds',
        last_heartbeat_at = v_now
    WHERE member.session_id = v_session_id
      AND member.participant_id = v_sender_id;

    RETURN QUERY SELECT
      v_existing.opaque_id,
      v_existing.inbox_revision,
      v_existing.expires_at,
      true;
    RETURN;
  END IF;

  IF p_sequence != v_member.last_webrtc_signal_sequence + 1 THEN
    RAISE EXCEPTION 'webrtc_signal_sequence_invalid';
  END IF;

  SELECT member.participant_id
  INTO v_recipient_id
  FROM capture_session_members AS member
  WHERE member.session_id = v_session_id
    AND member.participant_id != v_sender_id;

  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'capture_session_membership_invalid';
  END IF;

  DELETE FROM webrtc_signaling_messages AS message
  WHERE message.session_id = v_session_id
    AND message.expires_at <= v_now;

  SELECT COUNT(*)::integer
  INTO v_recent_count
  FROM webrtc_signaling_messages AS message
  WHERE message.session_id = v_session_id
    AND message.sender_participant_id = v_sender_id
    AND message.created_at > v_now - INTERVAL '10 seconds';

  IF v_recent_count >= 120 THEN
    RAISE EXCEPTION 'webrtc_signal_rate_limited';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_pending_count
  FROM webrtc_signaling_messages AS message
  WHERE message.session_id = v_session_id
    AND message.recipient_participant_id = v_recipient_id
    AND message.acknowledged_at IS NULL
    AND message.expires_at > v_now;

  IF v_pending_count >= 256 THEN
    RAISE EXCEPTION 'webrtc_signal_inbox_full';
  END IF;

  INSERT INTO webrtc_signaling_inboxes (session_id, participant_id)
  VALUES (v_session_id, v_recipient_id)
  ON CONFLICT (session_id, participant_id) DO NOTHING;

  UPDATE webrtc_signaling_inboxes AS inbox
  SET revision = inbox.revision + 1,
      updated_at = v_now
  WHERE inbox.session_id = v_session_id
    AND inbox.participant_id = v_recipient_id
  RETURNING inbox.revision INTO v_revision;

  v_expires_at := v_now + INTERVAL '2 minutes';

  INSERT INTO webrtc_signaling_messages (
    session_id,
    sender_participant_id,
    recipient_participant_id,
    sender_generation,
    sequence,
    negotiation_id,
    message_type,
    payload,
    inbox_revision,
    created_at,
    expires_at
  )
  VALUES (
    v_session_id,
    v_sender_id,
    v_recipient_id,
    p_generation,
    p_sequence,
    p_negotiation_id,
    p_message_type,
    p_payload,
    v_revision,
    v_now,
    v_expires_at
  )
  RETURNING opaque_id INTO v_message_id;

  UPDATE capture_session_members AS member
  SET last_webrtc_signal_sequence = p_sequence,
      lease_expires_at = v_now + INTERVAL '45 seconds',
      last_heartbeat_at = v_now
  WHERE member.session_id = v_session_id
    AND member.participant_id = v_sender_id;

  RETURN QUERY SELECT v_message_id, v_revision, v_expires_at, false;
END;
$$;

-- Acknowledge only messages addressed to the exact active lease owner. The
-- acknowledgement timestamp comes from the database clock, avoiding app/DB
-- clock skew and preventing a client from choosing cleanup timestamps.
CREATE OR REPLACE FUNCTION acknowledge_webrtc_signals(
  p_room_code text,
  p_capability_hash text,
  p_client_id uuid,
  p_generation integer,
  p_message_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_participant_id uuid;
  v_session_id uuid;
  v_acknowledged_count integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_message_ids IS NULL
    OR cardinality(p_message_ids) < 1
    OR cardinality(p_message_ids) > 100
    OR array_position(p_message_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'webrtc_acknowledgement_invalid';
  END IF;

  SELECT room.*
  INTO v_room
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

  SELECT participant.id
  INTO v_participant_id
  FROM participants AS participant
  WHERE participant.room_id = v_room.id
    AND participant.capability_hash = p_capability_hash;

  SELECT capture_session.id
  INTO v_session_id
  FROM room_capture_sessions AS capture_session
  WHERE capture_session.room_id = v_room.id
    AND capture_session.is_current;

  IF NOT EXISTS (
    SELECT 1
    FROM capture_session_members AS member
    WHERE member.session_id = v_session_id
      AND member.participant_id = v_participant_id
      AND member.active_webrtc_client_id = p_client_id
      AND member.active_client_generation = p_generation
      AND member.lease_expires_at > v_now
  ) THEN
    RAISE EXCEPTION 'webrtc_client_lease_lost';
  END IF;

  UPDATE webrtc_signaling_messages AS message
  SET acknowledged_at = v_now
  WHERE message.session_id = v_session_id
    AND message.recipient_participant_id = v_participant_id
    AND message.opaque_id = ANY(p_message_ids)
    AND message.acknowledged_at IS NULL
    AND message.expires_at > v_now;

  GET DIAGNOSTICS v_acknowledged_count = ROW_COUNT;

  DELETE FROM webrtc_signaling_messages AS message
  WHERE message.session_id = v_session_id
    AND message.expires_at <= v_now;

  RETURN v_acknowledged_count;
END;
$$;

-- No browser policies are intentionally created. Even a user who knows a room
-- code cannot inspect SDP, ICE candidates, generations, or inbox metadata.
ALTER TABLE webrtc_signaling_inboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE webrtc_signaling_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE webrtc_signaling_inboxes
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE webrtc_signaling_messages
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE webrtc_signaling_messages_id_seq
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE webrtc_signaling_inboxes TO service_role;
GRANT ALL ON TABLE webrtc_signaling_messages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE webrtc_signaling_messages_id_seq TO service_role;

REVOKE ALL ON FUNCTION claim_webrtc_client(text, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION renew_webrtc_client(text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_webrtc_client(text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enqueue_webrtc_signal(
  text, text, uuid, integer, bigint, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION acknowledge_webrtc_signals(
  text, text, uuid, integer, uuid[]
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION claim_webrtc_client(text, text, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION renew_webrtc_client(text, text, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION release_webrtc_client(text, text, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_webrtc_signal(
  text, text, uuid, integer, bigint, uuid, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION acknowledge_webrtc_signals(
  text, text, uuid, integer, uuid[]
) TO service_role;

COMMENT ON TABLE webrtc_signaling_inboxes IS
  'Protected per-recipient WebRTC signaling revisions; no browser role access';
COMMENT ON TABLE webrtc_signaling_messages IS
  'Short-lived protected SDP/ICE inbox; payloads never enter public Realtime';
COMMENT ON COLUMN capture_session_members.active_webrtc_client_id IS
  'Random per-document ID bound to the authoritative active-client generation';
COMMENT ON COLUMN capture_session_members.last_webrtc_signal_sequence IS
  'Last accepted strictly ordered signal sequence for the active generation';
COMMENT ON FUNCTION claim_webrtc_client(text, text, uuid, boolean) IS
  'Capability-authorized claim of the single active WebRTC client lease';
COMMENT ON FUNCTION enqueue_webrtc_signal(
  text, text, uuid, integer, bigint, uuid, text, jsonb
) IS
  'Capability-authorized, recipient-derived, ordered WebRTC inbox enqueue';
COMMENT ON FUNCTION acknowledge_webrtc_signals(
  text, text, uuid, integer, uuid[]
) IS
  'Capability-authorized acknowledgement of messages in the derived recipient inbox';
