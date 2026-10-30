# Shared Photo Strip V1 operations

## Supabase setup

Apply `supabase/migrations/002_shared_photo_strips.sql`. It creates:

- `room_photo_sets`, with RLS enabled and no browser-access policies;
- a private `room-photos` Storage bucket restricted to JPEG files up to 10 MB each;
- indexes for latest-set lookup and abandoned-upload cleanup.

The browser never receives the service-role key or room capability. Authorized API
routes create path-specific signed upload tokens and five-minute read URLs. Realtime
Broadcast carries only an opaque photo-set UUID and never carries image bytes.

## Retention and cleanup

Each successful publication removes older ready sets for that room. The current set
and any abandoned `uploading` reservations remain until an operational cleanup runs.

Before deleting expired room rows, schedule a Supabase Edge Function or trusted job
that uses the service role and Storage API to:

1. find `room_photo_sets` for expired rooms plus stale `uploading` rows;
2. remove every listed object from the `room-photos` bucket;
3. delete the manifests/expired rooms after Storage removal succeeds.

Do not delete directly from `storage.objects`, and do not add anonymous bucket or
table policies for cleanup. A daily job is sufficient for the 30-minute room model;
use a shorter interval if tighter deletion timing is required.
