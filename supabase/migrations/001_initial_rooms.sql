-- Photobooth V1 Initial Schema Migration
-- Creates rooms and participants tables with atomic join operations
-- All mutations are server-controlled via SECURITY DEFINER functions

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================

-- Enable pgcrypto for gen_random_uuid() (usually enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 2. ROOMS TABLE
-- ============================================================================

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  state text NOT NULL DEFAULT 'waiting',
  participant_count integer NOT NULL DEFAULT 0,
  max_participants integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_activity_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),

  -- Enforce valid state values
  CONSTRAINT valid_state CHECK (state IN ('waiting', 'active', 'completed', 'expired')),

  -- Enforce participant count bounds
  CONSTRAINT valid_participant_count CHECK (participant_count >= 0 AND participant_count <= max_participants),

  -- V1 requires exactly 2 participants maximum
  CONSTRAINT v1_max_participants CHECK (max_participants = 2)
);

-- Indexes for rooms table
CREATE INDEX idx_rooms_expires_at ON rooms(expires_at) WHERE state != 'expired';
CREATE INDEX idx_rooms_state ON rooms(state);

-- Enable Row Level Security on rooms
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- No anonymous policies - all access is server-controlled
-- RLS is enabled but no policies grant anonymous access
-- Server uses service role which bypasses RLS

-- ============================================================================
-- 3. PARTICIPANTS TABLE
-- ============================================================================

CREATE TABLE participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  capability_hash text UNIQUE NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at timestamptz NOT NULL DEFAULT NOW()
);

-- Indexes for participants table
CREATE INDEX idx_participants_room_id ON participants(room_id);
CREATE INDEX idx_participants_last_seen_at ON participants(last_seen_at);

-- Enable Row Level Security on participants
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

-- No anonymous policies - all access is server-controlled
-- capability_hash must never be exposed to clients

-- ============================================================================
-- 4. ATOMIC ROOM CREATION FUNCTION
-- ============================================================================

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
-- Set safe search_path to prevent search_path injection attacks
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id uuid;
  v_participant_id uuid;
BEGIN
  -- Create room with explicit V1 initial state
  -- participant_count = 1 (first participant)
  -- max_participants = 2 (V1 requirement)
  -- state = 'waiting' (waiting for 2nd participant)
  -- expires_at = created_at + 30 minutes (absolute expiration)
  INSERT INTO rooms (
    code,
    participant_count,
    max_participants,
    state,
    expires_at
  )
  VALUES (
    p_room_code,
    1,
    2,
    'waiting',
    NOW() + INTERVAL '30 minutes'
  )
  RETURNING id INTO v_room_id;

  -- Create first participant record
  -- If this fails, entire transaction rolls back (room not created)
  INSERT INTO participants (room_id, capability_hash)
  VALUES (v_room_id, p_capability_hash)
  RETURNING id INTO v_participant_id;

  -- Return identifiers for server to track
  RETURN QUERY SELECT v_room_id, v_participant_id;
END;
$$;

-- Restrict execution: only service role can call this function
-- Browser clients (anon/authenticated) cannot execute via RPC
REVOKE ALL ON FUNCTION create_room(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_room(text, text) FROM anon;
REVOKE ALL ON FUNCTION create_room(text, text) FROM authenticated;

-- Grant explicit EXECUTE to service role for clarity
-- In Supabase, service_role is typically granted via postgres role
-- This ensures only server-side operations (with service role key) can call the function
GRANT EXECUTE ON FUNCTION create_room(text, text) TO service_role;

-- ============================================================================
-- 5. ATOMIC ROOM JOINING FUNCTION
-- ============================================================================

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
-- Set safe search_path to prevent search_path injection attacks
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id uuid;
  v_room_code text;
  v_participant_id uuid;
  v_new_state text;
  v_new_count integer;
BEGIN
  -- Atomically reserve participant slot and validate room is joinable
  -- This UPDATE locks the row, preventing concurrent over-capacity joins
  UPDATE rooms
  SET participant_count = participant_count + 1,
      last_activity_at = NOW()
  WHERE code = p_room_code
    AND state = 'waiting'
    AND participant_count < max_participants
    AND expires_at > NOW()
  RETURNING id, code, participant_count INTO v_room_id, v_room_code, v_new_count;

  -- If no room was updated, it's either full, expired, or doesn't exist
  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'room_not_joinable'
      USING HINT = 'Room does not exist, is full, expired, or already active';
  END IF;

  -- Create participant record
  -- If this fails (e.g., duplicate capability_hash), entire transaction rolls back
  INSERT INTO participants (room_id, capability_hash)
  VALUES (v_room_id, p_capability_hash)
  RETURNING id INTO v_participant_id;

  -- Transition to active state if this is the 2nd participant
  IF v_new_count = 2 THEN
    UPDATE rooms
    SET state = 'active'
    WHERE id = v_room_id
      AND state = 'waiting'
    RETURNING state INTO v_new_state;
  ELSE
    v_new_state := 'waiting';
  END IF;

  -- Return success with room and participant identifiers
  RETURN QUERY SELECT v_room_id, v_room_code, v_participant_id, v_new_state;
END;
$$;

-- Restrict execution: only service role can call this function
-- Browser clients (anon/authenticated) cannot execute via RPC
REVOKE ALL ON FUNCTION join_room(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION join_room(text, text) FROM anon;
REVOKE ALL ON FUNCTION join_room(text, text) FROM authenticated;

-- Grant explicit EXECUTE to service role for clarity
-- In Supabase, service_role is typically granted via postgres role
-- This ensures only server-side operations (with service role key) can call the function
GRANT EXECUTE ON FUNCTION join_room(text, text) TO service_role;

-- ============================================================================
-- 6. COMMENTS (Documentation)
-- ============================================================================

COMMENT ON TABLE rooms IS 'Temporary collaborative photobooth sessions (expire 30 minutes after creation)';
COMMENT ON TABLE participants IS 'Session participants with capability-based authorization (hashed tokens)';

COMMENT ON COLUMN rooms.code IS 'Human-readable discovery code (e.g., MOON-47), NOT an authorization credential';
COMMENT ON COLUMN rooms.state IS 'Lifecycle state: waiting | active | completed | expired';
COMMENT ON COLUMN rooms.participant_count IS 'Denormalized count for fast capacity checks (max 2 in V1)';
COMMENT ON COLUMN rooms.expires_at IS 'Absolute expiration: created_at + 30 minutes';
COMMENT ON COLUMN rooms.last_activity_at IS 'Tracked for debugging/analytics, not used for V1 expiration logic';

COMMENT ON COLUMN participants.capability_hash IS 'SHA-256 hash of session capability token (NEVER expose to clients)';
COMMENT ON COLUMN participants.room_id IS 'Foreign key to rooms table (CASCADE DELETE when room deleted)';

COMMENT ON FUNCTION create_room(text, text) IS 'Atomically create room + first participant (server-only, SECURITY DEFINER)';
COMMENT ON FUNCTION join_room(text, text) IS 'Atomically join room + create participant with capacity enforcement (server-only, SECURITY DEFINER)';
