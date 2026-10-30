-- Shared Photo Strip V1
-- Photo bytes live in a private Storage bucket. Realtime carries only set IDs.

CREATE TABLE room_photo_sets (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'uploading',
  storage_paths text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  ready_at timestamptz,

  CONSTRAINT valid_photo_set_status CHECK (status IN ('uploading', 'ready')),
  CONSTRAINT four_storage_paths CHECK (cardinality(storage_paths) = 4),
  CONSTRAINT ready_photo_set_has_timestamp CHECK (
    (status = 'uploading' AND ready_at IS NULL)
    OR (status = 'ready' AND ready_at IS NOT NULL)
  )
);

CREATE INDEX idx_room_photo_sets_latest_ready
  ON room_photo_sets(room_id, ready_at DESC)
  WHERE status = 'ready';

CREATE INDEX idx_room_photo_sets_uploading_cleanup
  ON room_photo_sets(created_at)
  WHERE status = 'uploading';

ALTER TABLE room_photo_sets ENABLE ROW LEVEL SECURITY;

-- Browser clients receive short-lived, path-specific signed URLs only after the
-- application server validates their HttpOnly room capability.
REVOKE ALL ON TABLE room_photo_sets FROM PUBLIC;
REVOKE ALL ON TABLE room_photo_sets FROM anon;
REVOKE ALL ON TABLE room_photo_sets FROM authenticated;
GRANT ALL ON TABLE room_photo_sets TO service_role;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'room-photos',
  'room-photos',
  false,
  10485760,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Intentionally no storage.objects policies: anonymous clients cannot list,
-- read, write, or delete objects. Upload and download access is granted only by
-- narrow signed URLs created after server-side capability validation.

COMMENT ON TABLE room_photo_sets IS
  'Capability-protected manifests for temporary four-photo room snapshots';
COMMENT ON COLUMN room_photo_sets.id IS
  'Client-generated idempotency UUID; safe to broadcast as an invalidation key';
COMMENT ON COLUMN room_photo_sets.storage_paths IS
  'Four opaque private Storage object paths; never available through public DB access';
