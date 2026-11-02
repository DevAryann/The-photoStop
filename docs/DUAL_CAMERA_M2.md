# Milestone 2: Dual Camera V1

Milestone 2 adds a native, video-only WebRTC connection to capability-protected
two-person rooms. It reuses the existing `useCamera()` stream: one explicit
camera-sharing action starts one `getUserMedia({ audio: false })` request, and
that same stream feeds both the self-preview/capture canvas and the peer sender.

This milestone does not add microphone audio, synchronized countdowns, capture
scheduling, shared-editing changes, or changes to the legacy photo-strip data
flow.

## Apply the migration

Apply migrations `001` through `005` first, then apply:

```text
supabase/migrations/006_secure_webrtc_signaling.sql
```

With a linked Supabase project:

```bash
npx supabase db push
```

Otherwise, apply the file through the Supabase SQL editor in staging first. Do
not edit an already-applied migration. The migration is additive and leaves the
legacy `room_photo_sets` flow in place.

Migration 006 adds:

- a random active WebRTC client ID and ordered signal sequence to the existing
  `capture_session_members` generation lease;
- a per-recipient signaling inbox revision;
- short-lived offer, answer, ICE-batch, and ICE-restart messages;
- service-role-only functions to claim/renew/release a client lease and enqueue
  an ordered signal, plus recipient-bound acknowledgements; and
- closed RLS with no `anon` or `authenticated` policies or privileges.

## Connection and signaling flow

1. The user explicitly chooses **Share My Camera**. `useCamera()` requests one
   video stream with `audio: false` and never requests a second WebRTC stream.
2. `useRoomWebRtc()` obtains the existing authoritative capture session. Its
   server-assigned A/B position determines negotiation behavior: A creates the
   initial offer and B answers. B is the polite collision peer.
3. The hook claims the participant's existing client-generation lease. A second
   tab is rejected while that lease is live; **Use This Tab** force-advances the
   generation and invalidates the old tab. Page refreshes release with
   `pagehide`; a reload may force a stale page lease if release races. Sharing
   still requires the user's explicit camera action after refresh.
4. The protected ICE endpoint returns validated STUN URLs and optional
   short-lived TURN credentials.
5. The browser POSTs validated signals to the protected inbox endpoint. The
   server derives the sender from the HttpOnly capability and the recipient
   from the other authoritative capture-session member. The browser cannot choose
   a room UUID, participant UUID, sender, recipient, or A/B role.
6. After a committed inbox write, the server broadcasts only
   `{ "revision": number }` on the existing room Realtime channel. Both clients
   may see that opaque hint; only the intended capability can read the protected
   inbox. A 2.5-second protected poll, focus/online reads, and resubscription
   reads recover missed notifications. Interval polling runs while the document
   is visible; heartbeats continue while it is open, subject to browser timer
   throttling.
7. Messages are acknowledged after processing. Identical retries are
   deduplicated by session, sender, generation, and sequence. Unacknowledged
   messages expire after two minutes. Expiry prevents reads immediately; physical
   deletion is opportunistic on inbox/lease/write activity, not a guaranteed
   two-minute purge. Schedule a privileged periodic cleanup for abandoned rooms:

   ```sql
   DELETE FROM public.webrtc_signaling_messages WHERE expires_at <= now();
   ```
8. ICE candidates are buffered until the matching remote description exists.
   Negotiation UUIDs and sender generations discard stale answers/candidates.
   The A/B polite-peer rules handle offer collisions. Failed or prolonged
   disconnected states request up to two ICE restarts before presenting a
   manual reconnect. A replaces an unanswered offer when B arrives after its
   expiry or refreshes before answering. Expired TURN credentials are fetched
   again before restarting a connection.
9. Stopping the camera, ending/finalizing the room, losing room access, or
   unmounting closes the peer connection and stops transmission. The camera
   hook remains the sole owner responsible for stopping local media tracks.
   `pagehide` also stops the camera and peer immediately. The client checks its
   45-second lease expiry locally; if renewal becomes unavailable, it closes the
   peer rather than transmitting indefinitely without a lease. Lease takeover
   closes the old peer when detected by a protected read/heartbeat; its local
   camera preview may stay active until explicitly stopped.

Review and editor keep the legacy lifecycle: entering review/editor stops the
camera, and a retake explicitly restarts that same camera owner. Photos are
still captured from the local stream only. The partner preview is not composed
into the existing photo strip, and the countdown is not synchronized.

## Files

| File | Responsibility |
| --- | --- |
| `src/hooks/use-camera.ts` | Single video-only stream, permission deduplication, hardware errors, cleanup. |
| `src/hooks/use-room-webrtc.ts` | Native peer lifecycle, negotiation, protected signaling, buffering, lease and reconnect handling. |
| `src/lib/webrtc-signaling.ts` | Shared message types and bounded payload validation. |
| `src/lib/webrtc-server.ts` | Server-derived active member and client-generation checks. |
| `src/lib/webrtc-ice.ts` | Server-side ICE configuration and temporary coturn HMAC credentials. |
| `src/app/api/rooms/[code]/webrtc/signaling/route.ts` | Protected inbox, claim/heartbeat/release, signal writes and acknowledgements. |
| `src/app/api/rooms/[code]/webrtc/ice/route.ts` | Protected, non-cacheable ICE configuration. |
| `supabase/migrations/006_secure_webrtc_signaling.sql` | Closed inbox tables, deduplication, generation leases and service-role RPCs. |
| `src/hooks/use-room-realtime.ts` | Existing channel listens for opaque revision hints only. |
| `src/components/camera/dual-camera-stage.tsx` | Primary partner video, mirrored self-preview, accessible connection status. |
| `src/components/camera/camera-view.tsx` | Sharing consent/recovery/stop controls with existing capture and review flow. |
| `src/components/room/room-client.tsx` | Shared camera owner and room lifecycle/access integration. |
| `src/app/room/[code]/page.tsx` | Wider authorized room container. |
| `scripts/test-webrtc.mjs` | Isolated signaling/ICE helper unit checks; no camera, network, DB or real secrets. |
| `.env.example`, `README.md`, `docs/DUAL_CAMERA_M2.md` | Configuration and deployment/report documentation. |

## Environment variables

All TURN values are server-only. Never use a `NEXT_PUBLIC_` prefix for a shared
secret or permanent TURN credential.

| Variable | Required | Meaning |
| --- | --- | --- |
| `WEBRTC_STUN_URLS` | Yes unless TURN alone is used | Comma-separated `stun:` or `stuns:` URLs. |
| `WEBRTC_TURN_URLS` | Production | Comma-separated `turn:` / `turns:` URLs. Configure UDP, TCP, and TLS endpoints for broad reachability. |
| `WEBRTC_TURN_SHARED_SECRET` | With TURN URLs | The same high-entropy value as coturn `static-auth-secret`. Server-only. |
| `WEBRTC_TURN_TTL_SECONDS` | No | Credential lifetime, default 600 seconds and clamped to 60–3600. |
| `WEBRTC_ICE_TRANSPORT_POLICY` | No | `all` (default) or `relay`. `relay` suppresses direct peer paths and fails closed without TURN. |
| `WEBRTC_ALLOW_STUN_ONLY` | Local development only | Must be exactly `true` to run without TURN. This does not make STUN reliable in production. |

Example local-only fallback:

```dotenv
WEBRTC_STUN_URLS=stun:stun.l.google.com:19302
WEBRTC_ALLOW_STUN_ONLY=true
WEBRTC_ICE_TRANSPORT_POLICY=all
```

The example public STUN hostname is not a connectivity guarantee or a TURN
service. Production deployments should set `WEBRTC_ALLOW_STUN_ONLY=false` and
configure TURN.

## coturn-compatible TURN setup

The protected endpoint implements coturn's documented REST shared-secret
credential mechanism:

```text
username   = <unix-expiry>:<random-base64url-id>
credential = base64(HMAC-SHA1(static-auth-secret, username))
```

The shared secret remains on the application server and TURN server. Browsers
receive only a random, expiring username and its HMAC credential.

A generic coturn deployment needs, at minimum:

```text
use-auth-secret
static-auth-secret=<same high-entropy secret as WEBRTC_TURN_SHARED_SECRET>
realm=turn.example.com
fingerprint
listening-port=3478
tls-listening-port=5349
cert=/path/to/fullchain.pem
pkey=/path/to/private-key.pem
```

Also configure coturn's public/external IP mapping when behind NAT, a bounded
relay UDP port range, and firewall rules for:

- UDP 3478 (TURN/STUN);
- TCP 3478 (TURN over TCP);
- TCP 5349 (TURN over TLS); and
- the configured UDP relay port range.

Publish all needed transports, for example:

```dotenv
WEBRTC_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp
WEBRTC_TURN_SHARED_SECRET=<same coturn static-auth-secret>
WEBRTC_TURN_TTL_SECONDS=600
WEBRTC_ICE_TRANSPORT_POLICY=all
WEBRTC_ALLOW_STUN_ONLY=false
```

Use a valid TLS certificate for the `turns:` hostname. Verify credentials and
relay allocation with coturn's own tools before treating application tests as a
TURN health check. This project does not call a provider-specific credential
API.

## Security and reliability decisions

- Every ICE, inbox read, acknowledgement, lease action, and signal write checks
  the HttpOnly room capability and room expiration/state server-side.
- SDP and ICE candidates are absent from public Realtime and direct browser
  database access. Browser roles have closed RLS and revoked table/function
  privileges.
- The server derives both message parties. Public room codes remain discovery
  information, not authorization.
- Request JSON is stream-read with a 110 KiB byte limit, including bodies without
  Content-Length. SDP is capped at 65,536 characters; candidates at 4,096
  characters each and 64 per batch. Message JSON is database-capped at 96 KiB.
- The database accepts at most 120 signals per sender per ten seconds and at
  most 256 pending messages per recipient. Deployments should additionally use
  their normal edge/API rate limiter for abusive HTTP polling.
- Strict generation/sequence checks prevent stale tabs and replayed writes.
  Identical response-loss retries are safe; conflicting sequence reuse fails.
- POST rejects mismatched Origin headers and requires application/json; the
  existing HttpOnly/SameSite capability cookie is the credential. API responses
  use private/no-store caching. Client-supplied relational IDs never authorize a
  signal, a recipient or an acknowledgement.
- Presence is used only for friendly online/activity UI. It never authorizes a
  connection or determines the signaling recipient.
- Protected polling is intentional: Realtime is latency optimization, not a
  delivery or authorization boundary.
- Connection state handles browser refresh, temporary Realtime loss, temporary
  network loss, partner/host disconnection, candidate-before-SDP ordering, and
  manual reconnection.
- HTTP requests have a 12-second timeout. Async signaling operations are bound
  to the peer run and lease, so late failures/results cannot mutate a newer
  connection. Candidate and processed-message buffers are bounded.
- WebRTC encrypts media in transit (DTLS-SRTP), including over TURN. SDP/ICE are
  sensitive network metadata: do not publish them or export diagnostics without
  redaction. In `all` mode, peers can discover direct network addresses; use
  `relay` when that exposure is not acceptable. Also configure coturn quotas and
  peer-IP restrictions to prevent relay abuse; application limits do not replace
  TURN server hardening.

## Automated validation and unverified deployment work

Run from the repository root:

```bash
node scripts/test-webrtc.mjs
npx tsc --noEmit
npm run build
npm run lint
git diff --check
```

The helper tests cover UUID/generation bounds, SDP and ICE validation, inbox
metadata, restart payloads, explicit STUN fallback, coturn HMAC/randomness,
credential lifetime clamping, relay mode, and invalid configuration rejection.
They do not validate native browser negotiation, database RPC execution, or real
TURN allocations.

Implementation validation results:

| Check | Result |
| --- | --- |
| `node scripts/test-webrtc.mjs` | Passed: 10 helper test groups. |
| `npx tsc --noEmit` | Passed. |
| `npm run build` | Passed; both protected WebRTC API routes included. |
| `npm run lint` | Passed with 0 errors and 156 existing warnings outside changed implementation files. |
| Changed-file ESLint | Clean. |
| `git diff --check` | Passed; only Windows LF/CRLF notices. |

Migration 006 was not applied locally or remotely during implementation. Local
Supabase inspection was blocked because the Docker Linux engine was unavailable.
Two-device, responsive/accessibility, migration/RLS, and actual TURN tests remain
manual deployment acceptance checks. No manual browser/device tests were run.

## Manual two-device test matrix

Use two independent capabilities: create the room on device/browser A and join
normally from device/browser B. Copying one participant's authenticated tab does
not create the second participant.

1. **Consent and one stream** — start neither camera and verify no permission
   prompt. Choose **Share My Camera** on each device, verify one prompt per
   device, no microphone indicator, a small mirrored self-preview, and a large
   partner preview.
2. **Asymmetric start** — start A first, wait, then B. Repeat with B first. The
   stored inbox must recover the offer/restart without relying on a live
   Realtime event. Also delay B for more than two minutes to verify expired-offer
   replacement, and refresh B before the first answer completes.
3. **Permissions and hardware** — deny permission, test a device with no camera,
   and test a busy/unplugged camera. Verify actionable copy and **Try Again**.
4. **Stop/restart** — stop sharing on one device. Verify its outbound video
   ends, the partner moves to reconnecting/disconnected, then restart and verify
   live video returns.
5. **Temporary network loss** — disable network for 5–15 seconds, then restore
   it. Verify reconnecting state, protected inbox recovery, and ICE restart. Use
   manual **Reconnect** if automatic restart exhausts two attempts.
6. **Realtime loss** — block/disconnect the Realtime websocket while leaving
   HTTP available. Signaling must still complete through protected polling.
7. **Two tabs** — open a second tab with the same participant capability. It
   must show the active-tab warning. Choose **Use This Tab** and verify the old
   tab loses its generation and closes its peer connection.
8. **Refresh** — refresh A while connected. Verify pagehide release/reload
   takeover, then explicitly share again. Repeat on B and navigate away/back.
   Verify no camera transmission continues after leaving, no automatic sharing
   after refresh, and no duplicate camera stream in the same document.
9. **Room lifecycle** — end the room as host and verify both peers close. Test an
   expired capability/room and verify camera tracks stop with the generic room
   access message.
10. **TURN** — test across two genuinely different networks (for example home
    Wi-Fi and cellular), then inspect `chrome://webrtc-internals` or the browser
    equivalent. Confirm a `relay` candidate pair. Repeat with
    `WEBRTC_ICE_TRANSPORT_POLICY=relay`; success proves TURN relay reachability.
11. **Transport coverage** — separately restrict UDP to verify TURN/TCP, then
    test a network requiring TLS 5349. STUN-only success on an easy network does
    not satisfy this test.
12. **Legacy regression** — capture four photos, review/retake, edit, share,
    finalize, download, and end the room to confirm the existing photo-strip
    flow is unchanged.
13. **Stop during capture** — stop during countdown/pause and cancel a retake.
    Verify timers cancel, camera indicator turns off, and an original retake
    photo remains intact. Start again and complete a fresh four-photo set.
14. **Long signaling outage** — block the signaling API for more than 45 seconds
    while leaving the media network available. The peer must close after local
    lease expiry. Restore HTTP and explicitly reconnect.
15. **Expired TURN credentials** — in staging set a 60-second credential lifetime,
    connect, wait for expiry, then interrupt the media path. Reconnect must fetch
    fresh credentials rather than reuse expired ones.
16. **Cross-browser and responsive UI** — run desktop Chrome/Firefox/Edge and
    iOS Safari/Android Chrome pairs. Check portrait/landscape, 320px-wide layout,
    200% zoom, keyboard focus, screen-reader statuses and reduced-motion setting.

### Manual security / database acceptance (staging only)

17. **Capabilities and membership** — request both endpoints without a cookie,
    with an invalid capability, and with a capability from another room. All
    must fail generically without SDP/ICE/TURN credentials. A third participant
    must not gain access or change A/B membership.
18. **Public transport isolation** — inspect Realtime frames and browser DB
    requests during connection. The only new broadcast payload is `{revision}`;
    no SDP/candidates appear there. Direct anon/authenticated reads/writes to
    inbox tables and calls to all five signaling RPCs must be denied.
19. **Derived parties and acknowledgements** — in an authorized staging request,
    supply fake sender/recipient/role/room UUID fields. They cannot redirect the
    signal. Attempt to acknowledge the other participant's message handle; it
    must not affect that participant's inbox.
20. **Generation, sequence, expiry and replay** — replay an identical signal and
    verify one stored message. Reuse its sequence with different payload and
    verify rejection; test skipped sequence and stale generation after takeover.
    Expired messages must not be returned. Repeat acknowledgements safely.
21. **Payload and resource limits** — test malformed JSON, >110 KiB streamed
    requests without Content-Length, oversized SDP/candidates, and 65-candidate
    batches. Verify rejection without storage/broadcast. In staging verify the
    120/10-second sender limit and 256-pending-recipient backpressure.
22. **Lifecycle races and CSRF** — end/finalize a room while claim/signal/heartbeat
    is in flight and with Realtime blocked. Server requests must fail, local
    tracks must stop on access loss, and a foreign Origin POST must return 403.
    Inspect temporary TURN credentials and verify the shared secret never
    appears in responses or client bundles.

Camera APIs require a secure context. `localhost` is allowed for same-device
development; physical-device tests need HTTPS rather than a plain LAN HTTP URL.
