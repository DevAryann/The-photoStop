import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function loadHelper(relativePath) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url))
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  })
  const compiledModule = { exports: {} }
  runInNewContext(outputText, {
    module: compiledModule,
    exports: compiledModule.exports,
    require,
  }, { filename })
  return compiledModule.exports
}

const capture = loadHelper('../src/lib/capture-session.ts')
const jpeg = loadHelper('../src/lib/jpeg.ts')
const migration005 = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/005_authoritative_capture_sessions.sql', import.meta.url)),
  'utf8'
)
const migration007 = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/007_synchronized_capture_v1.sql', import.meta.url)),
  'utf8'
)
const stateServer = readFileSync(
  fileURLToPath(new URL('../src/lib/capture-session-server.ts', import.meta.url)),
  'utf8'
)
const imageRoute = readFileSync(
  fileURLToPath(new URL('../src/app/api/rooms/[code]/capture-session/image/route.ts', import.meta.url)),
  'utf8'
)
const captureClient = readFileSync(
  fileURLToPath(new URL('../src/components/camera/synchronized-capture-view.tsx', import.meta.url)),
  'utf8'
)

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`PASS ${name}`)
}

check('server clock offset uses low-latency midpoint samples', () => {
  const estimate = capture.estimateServerClock([
    { clientWallSendMs: 1_000, clientWallReceiveMs: 1_100, serverTimeMs: 1_550 },
    { clientWallSendMs: 2_000, clientWallReceiveMs: 2_020, serverTimeMs: 2_510 },
    { clientWallSendMs: 3_000, clientWallReceiveMs: 3_040, serverTimeMs: 3_520 },
    { clientWallSendMs: 4_000, clientWallReceiveMs: 3_999, serverTimeMs: 4_500 },
  ])
  assert.ok(estimate)
  assert.ok(Math.abs(estimate.offsetMs - 500) < 0.001)
  assert.equal(estimate.roundTripMs, 20)
  assert.equal(
    capture.getMonotonicCaptureDeadline(8_000, estimate, 7_000, 200),
    700
  )
})

check('duplicate attempt delivery schedules capture only once', () => {
  const attempt = 'aabbccdd-1234-4234-8234-aabbccddeeff'
  assert.equal(capture.shouldScheduleAttempt(null, attempt, 'reserved'), true)
  assert.equal(capture.shouldScheduleAttempt(attempt, attempt, 'reserved'), false)
  assert.equal(capture.shouldScheduleAttempt(null, attempt, 'verified'), false)
})

check('JPEG dimensions are derived from actual bytes', () => {
  const bytes = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0x01, 0x11,
    0xff, 0xd9,
  ])
  const dimensions = jpeg.readJpegDimensions(bytes)
  assert.equal(dimensions?.width, 1280)
  assert.equal(dimensions?.height, 720)
  assert.equal(jpeg.readJpegDimensions(Uint8Array.from([1, 2, 3])), null)
})

check('foundation enforces exact participants, moments, and pair association', () => {
  assert.match(migration005, /v_member_count != 2/)
  assert.match(migration005, /v_moment_count != 6/)
  assert.match(migration005, /UNIQUE \(attempt_id, participant_id\)/)
  assert.match(migration005, /complete_capture_attempt_requires_verified_pair/)
  assert.match(migration005, /FOREIGN KEY \(session_id, attempt_id\)/)
  assert.match(migration005, /FOREIGN KEY \(session_id, participant_id\)/)
})

check('both readiness and live generation leases gate one scheduled attempt', () => {
  assert.match(migration007, /v_ready_count = 2 AND v_live_lease_count = 2/)
  assert.match(migration007, /p_now \+ INTERVAL '5 seconds'/)
  assert.match(migration007, /idx_capture_attempts_one_open_per_moment/)
  assert.match(migration007, /active_webrtc_client_id IS DISTINCT FROM p_client_id/)
  assert.match(migration007, /active_client_generation != p_generation/)
})

check('paired verification advances only after both images and all six moments', () => {
  assert.match(migration007, /IF v_verified_count = 2 THEN/)
  assert.match(migration007, /SET armed_state = 'released', result_state = 'complete'/)
  assert.match(migration007, /IF v_completed_count = 6 THEN/)
  assert.match(migration007, /SET phase = 'completed'/)
  assert.match(migration007, /SET result_state = 'partial'/)
})

check('partial failure preserves the successful object and permits recovery', () => {
  assert.match(migration007, /upload_status != 'verified'/)
  assert.match(migration007, /IF v_verified_count = 1 THEN/)
  assert.match(migration007, /SET retry_scheduled_at = v_now \+ INTERVAL '5 seconds'/)
  assert.match(migration007, /UPDATE capture_attempts[\s\S]*result_state = 'cancelled'/)
  assert.doesNotMatch(migration007, /DELETE FROM capture_images/)
  assert.match(captureClient, /pendingCapturesRef/)
  assert.match(captureClient, /uploadToSignedUrl/)
  assert.match(imageRoute, /verifiedFromStoredBytes/)
})

check('upload authorization is participant-derived and idempotent', () => {
  assert.match(imageRoute, /getActiveWebRtcMember/)
  assert.match(imageRoute, /\.eq\('participant_id', participantId\)/)
  assert.match(imageRoute, /image\.upload_status === 'verified'/)
  assert.match(imageRoute, /upsert: false/)
  assert.match(imageRoute, /readJpegDimensions/)
})

check('refresh state exposes only positions and opaque attempt IDs', () => {
  assert.match(stateServer, /attemptId: attempt\.opaque_id/)
  assert.match(stateServer, /position: member\.position/)
  assert.doesNotMatch(stateServer, /participantId:/)
  assert.doesNotMatch(stateServer, /storagePath:/)
})

check('capabilities and browser-role isolation remain mandatory', () => {
  assert.match(migration007, /p_capability_hash/)
  assert.match(migration007, /participant\.capability_hash = p_capability_hash/)
  assert.match(migration007, /REVOKE ALL ON FUNCTION set_synchronized_capture_readiness/)
  assert.match(migration005, /ALTER TABLE capture_images ENABLE ROW LEVEL SECURITY/)
  assert.match(migration005, /REVOKE ALL ON TABLE capture_images FROM PUBLIC, anon, authenticated/)
})

console.log(`\n${passed} synchronized-capture test groups passed. Database execution and physical devices remain manual.`)
