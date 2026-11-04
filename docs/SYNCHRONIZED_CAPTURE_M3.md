# Milestone 3: Synchronized Capture V1

Milestone 3 adds a server-authoritative, six-moment paired capture flow alongside
the existing classic four-photo strip flow. It reuses the one local camera stream
and native WebRTC connection from Milestone 2. It does not send image bytes through
Realtime and does not import the twelve synchronized images into the four-photo
editor.

## Apply the migration

Apply migrations `001` through `006`, then apply:

```text
supabase/migrations/007_synchronized_capture_v1.sql
```

With a linked project:

```bash
npx supabase db push
```

Migration 007 is additive. It:

- adds the terminal capture-session phase `completed`;
- adds a client-safe opaque attempt ID;
- allows only one unfinished attempt for a logical moment;
- adds a per-image recovery timestamp for missing-side-only recapture;
- clears readiness when a participant generation changes or releases its lease;
- adds capability- and lease-protected readiness, scheduling, upload-completion,
  recovery, and database-clock functions; and
- retains the closed RLS and private `room-photos` Storage architecture.

The migration does not change the legacy `room_photo_sets`, editor, strip
finalization, room creation, or joining contracts.

## Architecture and capture flow

1. Each participant explicitly starts the existing `useCamera()` owner. The same
   local `MediaStream` supplies the local preview, WebRTC sender, and capture
   canvas. No second `getUserMedia()` call or remote-video capture is used.
2. `useRoomWebRtc()` claims the existing single-client generation lease. The
   synchronized UI receives only the local lease correlation values; the server
   still derives the room, session, participant, and A/B position from the
   capability cookie.
3. The client takes five protected state samples. Each sample carries the database
   clock. `estimateServerClock()` uses an NTP-style request midpoint and weights
   the three lowest-round-trip samples.
4. A participant can become ready only with an active generation lease. The
   database row-locks the room and schedules exactly one attempt only when both
   members are ready and both leases are live.
5. The database chooses `scheduled_capture_at = clock_timestamp() + 5 seconds`,
   creates both participant image reservations, and returns only the opaque attempt
   ID and A/B state.
6. Each browser converts that common server wall-clock time to a local
   `performance.now()` deadline. A coarse timeout yields to `requestAnimationFrame`
   near the deadline. Duplicate Realtime or polling results cannot schedule the
   same opaque attempt twice.
7. At the deadline, each browser draws only its own local video element at the
   source `videoWidth × videoHeight`, encodes JPEG at quality `0.92`, records its
   estimated server capture time and measured scheduling delta, and immediately
   begins upload.
8. The protected image route derives the participant image row, returns a signed
   upload token for its database-generated random path, then downloads the stored
   object through the admin client. JPEG signature, dimensions, and file size are
   computed from the actual private bytes before the row becomes `verified`.
9. One verified image moves an attempt to `partial`; it is preserved while the
   other participant retries. Two verified participant images atomically complete
   the attempt. If both leases remain live, the next incomplete moment is scheduled
   five seconds ahead.
10. Six complete attempts—one for each stable logical moment—move the authoritative
    session to `completed`. Only those six verified pairs count, giving twelve
    completed-session images.

Supabase Broadcast event `capture_state_changed` contains only the opaque session
ID and revision. It is a wake-up hint. A protected 2.5-second poll, focus/online
refresh, and Realtime resubscription recover missed notifications.

## Explicit client state machine

| State | Meaning | Authoritative exit |
| --- | --- | --- |
| `waiting_participants` | Both local/remote live cameras and a valid lease are not available. | Protected state plus WebRTC connection become available. |
| `waiting_readiness` | No open attempt; one or both members are not ready. | Both lease-bound readiness rows become true and the server schedules. |
| `scheduled` | A shared attempt exists more than three seconds ahead. | Monotonic deadline approaches. |
| `countdown` | The common deadline is within three seconds. | Local monotonic deadline fires. |
| `capturing` | The browser is drawing/encoding its local frame. | A local Blob is created or capture fails recoverably. |
| `uploading` | The local private upload and verification are in progress. | Protected state reports verified or the Blob remains locally retryable. |
| `waiting_partner_upload` | This participant is verified; the paired image is not. | The server verifies the other image. |
| `moment_completed` | Both images on the exact attempt are verified. | The server schedules the next incomplete moment. |
| `session_completed` | Six complete pairs exist. | Terminal for synchronized capture V1. |
| `recoverable_failure` | A deadline was missed, camera failed, or a captured Blob/upload needs recovery. | Retry the same upload, recapture only the missing side, or schedule a fresh shared attempt if neither side verified. |

The client never increments a moment, creates an attempt, or declares completion.

## Recovery behavior

- **Duplicate Broadcast/poll results:** the opaque attempt ID is marked handled
  before local scheduling; verified local images are never scheduled again.
- **Network interruption during countdown:** capture remains tied to the local
  monotonic deadline and does not wait for an upload request. Upload can retry when
  the network returns.
- **One upload fails:** the successful verified image remains. The failed browser
  retains its Blob in memory and retries only its own upload.
- **Refresh after one side succeeded:** the missing participant can request a new
  server timestamp on the same moment and attempt. The verified participant does
  not recapture, so the completed moment still has exactly two verified rows.
- **Refresh after neither side succeeded:** the stale attempt is cancelled and a
  new shared attempt number is scheduled for the same logical moment.
- **Refresh/reconnect:** protected state reconstructs all six moments, current
  attempt, readiness, upload status, and private signed previews. Camera permission
  is still explicit after refresh.
- **Multiple tabs:** readiness and every image mutation require the exact active
  WebRTC client ID and generation. Taking over the lease clears old readiness and
  invalidates old-tab mutations.
- **Participant leaves:** graceful lease release clears readiness. Expired leases
  are not considered live by scheduling. An already scheduled local capture may
  still occur during a brief transport interruption, but pair completion waits for
  both verified objects.
- **Stale attempts:** unfinished attempts older than 90 seconds are cancelled before
  a replacement is scheduled.

## API changes

All responses are private/no-store and all mutations retain same-origin checks.

### `GET /api/rooms/[code]/capture-session`

The existing `session` response remains. A protected `capture` projection now adds:

- database `serverTimeMs`;
- caller A/B position;
- A/B readiness and live-lease booleans;
- six moment statuses;
- the current opaque attempt, attempt number, schedule, and A/B upload statuses;
- short-lived read-only URLs for verified images; and
- completed moment count.

Internal room, participant, session-row, moment, attempt-row, and image IDs and all
Storage paths remain absent.

### `PATCH /api/rooms/[code]/capture-session`

Accepts `ready`, `not_ready`, or `restart` plus the active client ID/generation.
The database derives participant ownership and serializes scheduling under a room
lock. `restart` recaptures only the missing participant when one image is already
verified.

### `POST /api/rooms/[code]/capture-session/image`

Reserves only the caller's pre-created image row for the supplied opaque attempt.
Returns one narrow signed upload token. It accepts JPEG only, up to 10 MiB, with
`upsert: false`.

### `PATCH /api/rooms/[code]/capture-session/image`

Downloads and validates actual private bytes, derives JPEG dimensions/size, records
bounded timing metadata, and invokes the atomic pair-completion function. Repeated
verification of an already verified image is idempotent.

## Security and privacy

- The HttpOnly capability cookie remains the authorization credential. Opaque IDs
  are correlation values only.
- Every mutation re-derives room/session/member ownership server-side and validates
  the active participant generation.
- Capture tables remain closed to `PUBLIC`, `anon`, and `authenticated` roles.
- The existing private `room-photos` bucket is reused. No public object policy is
  added.
- Clients cannot choose participant IDs, room IDs, A/B roles, relational attempt
  IDs, image rows, or object paths.
- Image bytes and base64 never enter Realtime or application JSON requests.
- Database uniqueness prevents duplicate open attempts and duplicate participant
  images. Signed uploads disallow overwrite.
- Actual stored JPEG dimensions and bytes—not client declarations—are verified.

## Automated validation

Run:

```bash
npm run test:capture
node scripts/test-webrtc.mjs
node scripts/test-webrtc-origin.mjs
npx tsc --noEmit
npm run build
npm run lint
git diff --check
```

`test:capture` covers clock offset/deadline calculations, duplicate scheduling,
actual JPEG dimension parsing, exact shape/association constraints, both-ready
scheduling, lease authorization, paired completion, partial preservation,
missing-side recovery, upload idempotency, opaque serialization, and closed
browser privileges. It is isolated and does not execute a database or camera.

## Manual two-device acceptance

Use two devices or independent browsers with two separately joined participant
capabilities. Physical devices require a shared HTTPS origin. Apply migration 007
to staging first.

1. Open the same active room on A and B. Select **Together · 6 moments** and
   explicitly share each camera. Confirm microphone permission is never requested.
2. Confirm the two live previews and A/B labels are visible on desktop and mobile.
   Ready A only: no attempt should be created. Ready B: both devices should show
   the same moment and countdown.
3. Record both screens (or inspect stored timing metadata) through all six moments.
   Confirm each attempt has the same scheduled timestamp and two verified images.
4. Confirm the paired preview appears after each moment and progress reaches six.
   Confirm the session becomes `completed` only with twelve verified images across
   six complete attempts.
5. Block Realtime while leaving HTTP available. Polling must recover scheduling and
   pair completion. Then interrupt HTTP during countdown: local capture should still
   fire near the deadline and upload after recovery.
6. Fail one upload while allowing the partner upload to complete. Confirm the
   successful image remains, **Retry My Upload** sends only the missing image, and
   the moment does not complete early.
7. After one side verifies, refresh the missing side. Reconnect its camera and use
   **Recapture My Missing Photo**. Confirm the same opaque attempt completes and the
   verified peer does not recapture.
8. Refresh before either side uploads. Confirm the old attempt is cancelled and a
   higher attempt number is jointly scheduled for the same moment.
9. Open a second tab for A. Confirm it cannot mutate readiness/upload until **Use
   This Tab** takes the generation; takeover must clear old readiness.
10. Revoke camera permission, unplug/stop a camera, disconnect/reconnect WebRTC, and
    test focus/background recovery. Errors must provide camera retry, reconnect, or
    moment recovery without advancing client-side.
11. Inspect Realtime frames: only opaque session/revision hints may appear. Inspect
    Storage: objects remain private and paths are random. Try foreign capability,
    participant, attempt, and generation values; all must fail generically.
12. Switch to **Classic · 4 photos** and complete capture, review, retake, editor,
    share, finalization, and download. Confirm that flow remains independent.
13. Test iOS Safari and Android Chrome at 320 px portrait, landscape, 200% zoom,
    keyboard/screen-reader status announcements, and reduced motion.

## Synchronization limitations

- Browser JavaScript cannot guarantee simultaneous sensor exposure. Camera frame
  cadence, media pipelines, device load, browser scheduling, background throttling,
  and JPEG encoding vary by device.
- The displayed `±` value is half the best observed HTTP round trip, not a proof of
  clock-error symmetry. Asymmetric network routes can add unobserved offset error.
- `requestAnimationFrame` and `performance.now()` improve local deadline scheduling,
  but backgrounded tabs and power-saving modes may be delayed.
- `drawImage()` captures the most recently decoded frame available at the deadline,
  not a hardware shutter command. Stored `scheduledDeltaMs`,
  `monotonicLatenessMs`, clock offset, and round-trip estimates make practical
  accuracy observable.

No physical two-device synchronization was performed as part of the automated
implementation. It must not be represented as verified until the manual matrix is
completed on two separate devices.
