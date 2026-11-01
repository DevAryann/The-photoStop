# Milestone 1: Authoritative Capture Session Foundation

This milestone adds an authoritative two-person capture model alongside the
legacy four-photo `room_photo_sets` flow. It does not connect the current camera,
editor, export, or finalization UI to the new model.

## Database model

Apply `supabase/migrations/005_authoritative_capture_sessions.sql` after
migrations `001` through `004`.

### `room_capture_sessions`

- Stores a capture lifecycle independently of `rooms.state`.
- Allows at most one `is_current = true` session per room through a partial
  unique index, while leaving room for historical sessions in a future migration.
- Uses an internal relational UUID plus a separate opaque UUID intended only for
  client-side correlation. The opaque value is not an authorization credential.
- Restricts `phase` to:
  `camera_setup`, `preparing`, `countdown`, `capturing`, `selecting`, `editing`,
  `finalizing`, and `finalized`.
- Starts at revision 1. A trigger increments the revision and updates
  `updated_at` for every session update; callers cannot choose a revision.

### `capture_session_members`

- Contains exactly two members for every capture session.
- Composite foreign keys require each member to be a participant in the same
  room as the session.
- Maps immutable room identity `participant-1` to capture position A and
  `participant-2` to position B. A trigger rejects any other mapping or later
  reassignment.
- Provides readiness, heartbeat, active-client generation, and optional lease
  fields for later coordination work.
- Active-client generations cannot decrease.

### `capture_moments`

- Contains exactly six stable logical moments for every session.
- `capture_index` is constrained to 1–6 and unique within a session.
- Retries do not replace a moment; they are represented by child attempts.

### `capture_attempts`

- Belongs to one moment in the same session through a composite foreign key.
- Has a positive attempt number and generation. Attempt numbers are unique per
  logical moment.
- Requires a server-selected `scheduled_capture_at` timestamp.
- Validates preparation, armed, and result states. This milestone does not add
  the mutations that transition those states.

### `capture_images`

- Allows at most one image for each participant on an attempt.
- Composite foreign keys guarantee that the attempt and participant belong to
  the same capture session.
- A database trigger always derives a random private object path. A caller-sent
  path is ignored, and room, participant, attempt, and image row IDs are not
  embedded in it.
- Tracks reservation/upload/verification state, dimensions, byte size,
  capture time, and JSON capture metadata.
- A verified image must include positive dimensions, a positive file size no
  larger than the existing 10 MB bucket limit, and a capture timestamp.
- An attempt may be marked `complete` only when it has exactly two verified
  images. Because session membership is exactly A and B and images are unique by
  attempt/participant, those images necessarily belong to both participants on
  the same attempt.

Exact two-member, six-moment, and complete-pair checks are deferred constraint
triggers. This lets trusted transactions create related rows in any order while
still rejecting an invalid shape at commit.

## Session creation behavior

`get_or_create_room_capture_session(room_code, capability_hash)` is a
service-role-only `SECURITY DEFINER` function.

It:

1. locks the room row, serializing concurrent creation attempts;
2. verifies expiration and the hashed participant capability;
3. rejects ended rooms and rooms that are not active;
4. verifies the room has exactly its two stable participants;
5. returns the existing current session, or atomically creates the session,
   its A/B members, and moments 1–6; and
6. derives the requesting participant's A/B position from database identity.

The room row lock plus the one-current-session unique index make creation
idempotent and concurrency-safe. Session creation does not change the room
lifecycle or host ownership.

## API

Both endpoints require the existing `session_capability` HttpOnly cookie and
return `Cache-Control: no-store`.

### `POST /api/rooms/[code]/capture-session`

Creates or obtains the current session. It accepts no request body, so the client
cannot submit a room UUID, participant UUID, role, A/B position, owner, phase, or
revision.

The first successful request returns HTTP 201 with `created: true`. Repeated or
concurrent requests return the same session with HTTP 200 and `created: false`.
A room must be active, unexpired, and not ended.

### `GET /api/rooms/[code]/capture-session`

Fetches without creating. It returns `{ "session": null }` when an authorized
room has no capture session. An existing session remains readable as metadata
after the room is ended, but no authoritative mutation is allowed on an ended
room.

The safe session response contains only:

```json
{
  "session": {
    "sessionId": "opaque-correlation-uuid",
    "phase": "camera_setup",
    "revision": 1,
    "participantPosition": "A",
    "createdAt": "server timestamp",
    "updatedAt": "server timestamp",
    "moments": [
      { "captureIndex": 1 },
      { "captureIndex": 2 },
      { "captureIndex": 3 },
      { "captureIndex": 4 },
      { "captureIndex": 5 },
      { "captureIndex": 6 }
    ]
  }
}
```

It does not expose internal room, participant, session-row, moment, attempt, or
image identifiers; capability hashes; host ownership fields; or Storage paths.

## Security and Storage

- RLS is enabled on all five new tables, with no browser policies.
- `PUBLIC`, `anon`, and `authenticated` privileges are revoked.
- Only `service_role` can execute session creation or access the tables.
- Capability authorization, room expiration, room activity, and ended-state
  checks happen inside the same database operation that creates a session.
- No anonymous table or `storage.objects` policy is added.
- No new bucket is created. Future image upload work should use path-specific
  signed operations against the existing private `room-photos` bucket.
- The opaque session ID is a correlation value, not a bearer credential. Room
  access always continues to require the HttpOnly capability.

## Compatibility and future work

- Migrations `001`–`004`, `rooms`, `participants`, and `room_photo_sets` remain
  in place. Existing camera, four-photo sharing, editor, export, end-room, and
  host finalization behavior is unchanged.
- Capture phases and attempt states are foundations only. Countdown scheduling,
  attempt creation, heartbeats/leases, image reservation and verification,
  Realtime invalidation, and phase transitions require future capability-
  protected server mutations.
- A future attempt-creation mutation must generate `scheduled_capture_at` on the
  server and bind the attempt generation to the authoritative active-client
  generation. It must not accept participant ownership or Storage paths from a
  browser.
- A future image upload flow should mark an image `verified` only after checking
  the private object and its metadata. Realtime should remain an invalidation
  signal; database state remains authoritative.
- Shared editing and final capture-session finalization are intentionally not
  implemented in this milestone.

## Applying the migration

Use the normal Supabase migration workflow from the repository root:

```bash
npx supabase db push
```

If this project is not linked to Supabase CLI, apply
`supabase/migrations/005_authoritative_capture_sessions.sql` through the
Supabase SQL editor after confirming migrations `001`–`004` are already present.
Apply it to a staging project first and do not edit previously applied migration
files.

## Manual verification checklist

1. Create a room and verify POST returns 409 while only the host is present.
2. Join from a second browser, call POST from both participants, and verify both
   receive the same opaque session ID, opposite A/B positions, and moments 1–6.
3. Send concurrent POST requests and confirm there is one current session, two
   members, and six moments in the database.
4. Repeat POST and verify HTTP 200 with `created: false`; verify GET returns the
   same phase, revision, timestamps, position, and moments.
5. Try missing/wrong capabilities, expired rooms, and ended rooms. Creation must
   fail without revealing whether a room or participant identifier exists.
6. With the anonymous Supabase key, confirm direct reads and writes against all
   five new tables are denied and the private bucket cannot be listed/read.
7. In staging SQL, verify a session with fewer than two members or fewer than six
   moments cannot commit, a member cannot be assigned the wrong position, and a
   `complete` attempt cannot commit without one verified image from each member.
8. Exercise the existing four-photo share, editor, finalization, download, and
   end-room flows to confirm the additive model caused no legacy regressions.
