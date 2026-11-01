-- Photo Strip Finalization V1
-- Atomically pins one ready photo-set and its exact render settings to a room.

ALTER TABLE rooms
  ADD COLUMN finalized_photo_set_id uuid,
  ADD COLUMN finalized_at timestamptz,
  ADD COLUMN finalized_render_config jsonb,
  ADD CONSTRAINT finalized_strip_fields_are_atomic CHECK (
    (finalized_photo_set_id IS NULL AND finalized_at IS NULL AND finalized_render_config IS NULL)
    OR
    (finalized_photo_set_id IS NOT NULL AND finalized_at IS NOT NULL AND finalized_render_config IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION is_valid_photo_strip_render_config(p_config jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sticker jsonb;
  v_sticker_count integer;
  v_distinct_slot_count integer;
  v_distinct_id_count integer;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) != 'object' THEN
    RETURN false;
  END IF;

  IF NOT (
    p_config ? 'backgroundColor'
    AND p_config ? 'stripStyle'
    AND p_config ? 'photoFilter'
    AND p_config ? 'stickers'
    AND p_config ? 'caption'
  ) THEN
    RETURN false;
  END IF;

  IF p_config->>'backgroundColor' NOT IN ('#ffffff', '#000000', '#faf8f3', '#d4f1f0', '#fde8e8')
    OR p_config->>'stripStyle' NOT IN ('plain', 'polaroid', 'retro')
    OR p_config->>'photoFilter' NOT IN ('original', 'vintage', 'grayscale', 'warm')
    OR jsonb_typeof(p_config->'caption') != 'string'
    OR char_length(p_config->>'caption') > 80
    OR jsonb_typeof(p_config->'stickers') != 'array'
    OR jsonb_array_length(p_config->'stickers') > 8
  THEN
    RETURN false;
  END IF;

  v_sticker_count := jsonb_array_length(p_config->'stickers');
  SELECT
    COUNT(DISTINCT sticker->>'slot'),
    COUNT(DISTINCT sticker->>'id')
  INTO v_distinct_slot_count, v_distinct_id_count
  FROM jsonb_array_elements(p_config->'stickers') AS sticker;

  IF v_distinct_slot_count != v_sticker_count
    OR v_distinct_id_count != v_sticker_count
  THEN
    RETURN false;
  END IF;

  FOR v_sticker IN SELECT * FROM jsonb_array_elements(p_config->'stickers')
  LOOP
    IF jsonb_typeof(v_sticker) != 'object'
      OR jsonb_typeof(v_sticker->'id') != 'string'
      OR (v_sticker->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR jsonb_typeof(v_sticker->'emoji') != 'string'
      OR v_sticker->>'emoji' NOT IN ('❤️', '⭐', '✨', '🌸', '😊')
      OR jsonb_typeof(v_sticker->'slot') != 'number'
      OR (v_sticker->>'slot') !~ '^[0-7]$'
    THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION is_valid_photo_strip_render_config(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_valid_photo_strip_render_config(jsonb) FROM anon;
REVOKE ALL ON FUNCTION is_valid_photo_strip_render_config(jsonb) FROM authenticated;

ALTER TABLE rooms
  ADD CONSTRAINT finalized_render_config_is_valid CHECK (
    finalized_render_config IS NULL
    OR is_valid_photo_strip_render_config(finalized_render_config)
  );

CREATE OR REPLACE FUNCTION finalize_photo_strip(
  p_room_code text,
  p_capability_hash text,
  p_photo_set_id uuid,
  p_render_config jsonb
)
RETURNS TABLE (
  finalized_photo_set_id uuid,
  room_finalized_at timestamptz,
  render_config jsonb,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_participant_id uuid;
  v_photo_set room_photo_sets%ROWTYPE;
  v_latest_photo_set_id uuid;
  v_finalized_at timestamptz;
  v_expected_paths text[];
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

  -- The first committed finalization is immutable. Repeated host requests return
  -- that exact result, even if a stale tab submits a different local set.
  IF v_room.finalized_photo_set_id IS NOT NULL THEN
    RETURN QUERY SELECT
      v_room.finalized_photo_set_id,
      v_room.finalized_at,
      v_room.finalized_render_config,
      false;
    RETURN;
  END IF;

  IF v_room.state != 'active' THEN
    RAISE EXCEPTION 'room_not_finalizable';
  END IF;

  IF NOT is_valid_photo_strip_render_config(p_render_config) THEN
    RAISE EXCEPTION 'invalid_render_config';
  END IF;

  SELECT *
  INTO v_photo_set
  FROM room_photo_sets
  WHERE id = p_photo_set_id
    AND room_id = v_room.id
    AND status = 'ready'
    AND ready_at IS NOT NULL;

  v_expected_paths := ARRAY[
    format('photo-sets/%s/1.jpg', p_photo_set_id),
    format('photo-sets/%s/2.jpg', p_photo_set_id),
    format('photo-sets/%s/3.jpg', p_photo_set_id),
    format('photo-sets/%s/4.jpg', p_photo_set_id)
  ];

  IF v_photo_set.id IS NULL OR v_photo_set.storage_paths != v_expected_paths THEN
    RAISE EXCEPTION 'photo_set_not_ready';
  END IF;

  SELECT id
  INTO v_latest_photo_set_id
  FROM room_photo_sets
  WHERE room_id = v_room.id
    AND status = 'ready'
  ORDER BY ready_at DESC, id DESC
  LIMIT 1;

  IF v_latest_photo_set_id IS DISTINCT FROM p_photo_set_id THEN
    RAISE EXCEPTION 'photo_set_not_current';
  END IF;

  UPDATE rooms
  SET finalized_photo_set_id = p_photo_set_id,
      finalized_at = NOW(),
      finalized_render_config = p_render_config,
      last_activity_at = NOW()
  WHERE id = v_room.id
  RETURNING finalized_at INTO v_finalized_at;

  RETURN QUERY SELECT p_photo_set_id, v_finalized_at, p_render_config, true;
END;
$$;

REVOKE ALL ON FUNCTION finalize_photo_strip(text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_photo_strip(text, text, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION finalize_photo_strip(text, text, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION finalize_photo_strip(text, text, uuid, jsonb) TO service_role;

-- Serialize photo manifest mutations against room finalization. If finalization
-- wins the room-row lock, no reservation, publication, replacement, or cleanup
-- can mutate any manifest in that room afterward.
DROP TRIGGER IF EXISTS room_photo_sets_reject_ended_room ON room_photo_sets;
DROP FUNCTION IF EXISTS reject_ended_room_photo_mutation();

CREATE OR REPLACE FUNCTION reject_read_only_room_photo_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_state text;
  v_finalized_photo_set_id uuid;
  v_room_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.room_id ELSE NEW.room_id END;
BEGIN
  SELECT state, finalized_photo_set_id
  INTO v_room_state, v_finalized_photo_set_id
  FROM rooms
  WHERE id = v_room_id
  FOR UPDATE;

  IF v_room_state = 'ended' THEN
    RAISE EXCEPTION 'room_ended';
  END IF;

  IF v_finalized_photo_set_id IS NOT NULL THEN
    RAISE EXCEPTION 'strip_finalized';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER room_photo_sets_reject_read_only_room
BEFORE INSERT OR UPDATE OR DELETE ON room_photo_sets
FOR EACH ROW
EXECUTE FUNCTION reject_read_only_room_photo_mutation();

REVOKE ALL ON FUNCTION reject_read_only_room_photo_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_read_only_room_photo_mutation() FROM anon;
REVOKE ALL ON FUNCTION reject_read_only_room_photo_mutation() FROM authenticated;

COMMENT ON COLUMN rooms.finalized_photo_set_id IS
  'Immutable ready room_photo_sets UUID selected by the host for the final strip';
COMMENT ON COLUMN rooms.finalized_at IS
  'Server timestamp set exactly once when the shared strip is finalized';
COMMENT ON COLUMN rooms.finalized_render_config IS
  'Validated immutable editor settings used by every participant to render the final PNG';
COMMENT ON FUNCTION finalize_photo_strip(text, text, uuid, jsonb) IS
  'Atomically host-authorizes and idempotently finalizes one ready shared photo strip';
