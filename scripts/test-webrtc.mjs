import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Dependency-free unit checks for the real TypeScript helpers. Configuration is
// evaluated with an isolated environment; no .env file, network, camera, or DB
// is accessed. These checks do not replace browser or migration testing.
const require = createRequire(import.meta.url)
function loadHelper(relativePath, env = {}) {
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
    process: { env },
  }, { filename })
  return compiledModule.exports
}

const signaling = loadHelper('../src/lib/webrtc-signaling.ts')
const uuid = 'aabbccdd-1234-4234-8234-aabbccddeeff'
const candidate = {
  candidate: 'candidate:1 1 UDP 2122260223 192.0.2.1 5000 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0,
  usernameFragment: 'test',
}
let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`PASS ${name}`)
}

check('UUID and generation bounds', () => {
  assert.equal(signaling.isUuid(uuid), true)
  for (const invalid of [null, '', 'room-code', uuid.replace('-4', '-0')]) {
    assert.equal(signaling.isUuid(invalid), false)
  }
  for (const valid of [1, 2147483647]) {
    assert.equal(signaling.isPositiveSignalNumber(valid), true)
  }
  for (const invalid of [0, -1, 1.5, '1', Infinity, 2147483648]) {
    assert.equal(signaling.isPositiveSignalNumber(invalid), false)
  }
})

check('SDP validation and size boundary', () => {
  assert.ok(signaling.parseRoomWebRtcSignalPayload('offer', { sdp: 'v=0\r\n' }))
  assert.ok(signaling.parseRoomWebRtcSignalPayload('answer', { sdp: `v=0${'x'.repeat(65533)}` }))
  for (const invalid of ['', 'not-sdp', `v=0${'x'.repeat(65534)}`, null]) {
    assert.equal(signaling.parseRoomWebRtcSignalPayload('offer', { sdp: invalid }), null)
  }
  assert.equal(signaling.parseRoomWebRtcSignalPayload('answer', []), null)
})

check('ICE batches, end markers, and field validation', () => {
  assert.ok(signaling.parseRoomWebRtcSignalPayload('ice', { candidates: [candidate, null] }))
  assert.ok(signaling.parseRoomWebRtcSignalPayload('ice', { candidates: Array(64).fill(candidate) }))
  for (const candidates of [[], Array(65).fill(candidate), [{}]]) {
    assert.equal(signaling.parseRoomWebRtcSignalPayload('ice', { candidates }), null)
  }
  for (const invalid of [
    { ...candidate, candidate: '' },
    { ...candidate, candidate: 'x'.repeat(4097) },
    { ...candidate, sdpMid: 'x'.repeat(257) },
    { ...candidate, sdpMLineIndex: -1 },
    { ...candidate, sdpMLineIndex: 0.5 },
    { ...candidate, usernameFragment: 123 },
  ]) {
    assert.equal(signaling.parseRoomWebRtcSignalPayload('ice', { candidates: [invalid] }), null)
  }
})

check('Restart messages carry no arbitrary payload', () => {
  assert.ok(signaling.parseRoomWebRtcSignalPayload('restart', {}))
  assert.equal(signaling.parseRoomWebRtcSignalPayload('restart', { recipient: uuid }), null)
})

check('Inbox schema and metadata validation', () => {
  const message = {
    id: uuid, revision: 1, senderGeneration: 1, sequence: 1,
    negotiationId: uuid, type: 'offer', payload: { sdp: 'v=0\r\n' },
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  }
  assert.ok(signaling.parseRoomWebRtcInboxMessage(message))
  for (const invalid of [
    { ...message, senderGeneration: 0 },
    { ...message, sequence: 0 },
    { ...message, revision: -1 },
    { ...message, negotiationId: 'invalid' },
    { ...message, type: 'arbitrary' },
    { ...message, expiresAt: 'invalid' },
  ]) {
    assert.equal(signaling.parseRoomWebRtcInboxMessage(invalid), null)
  }
})

function ice(env) {
  return loadHelper('../src/lib/webrtc-ice.ts', env).createProtectedIceConfiguration()
}
const turnEnv = {
  WEBRTC_STUN_URLS: 'stun:stun.example.com:3478',
  WEBRTC_TURN_URLS: 'turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp',
  WEBRTC_TURN_SHARED_SECRET: 'isolated-test-secret-not-a-real-credential',
}

check('TURN fails closed without configuration', () => {
  assert.throws(() => ice({}), /TURN is not configured/)
  assert.throws(() => ice({ WEBRTC_STUN_URLS: 'stun:stun.example.com:3478' }), /TURN is not configured/)
})

check('STUN-only fallback is explicit and never relay-only', () => {
  const env = { WEBRTC_ALLOW_STUN_ONLY: 'true', WEBRTC_STUN_URLS: 'stun:stun.example.com:3478' }
  const config = ice(env)
  assert.equal(config.turnConfigured, false)
  assert.equal(config.expiresAt, null)
  assert.equal(config.iceTransportPolicy, 'all')
  assert.throws(() => ice({ ...env, WEBRTC_ICE_TRANSPORT_POLICY: 'relay' }), /requires a configured TURN/)
  assert.throws(() => ice({ ...env, WEBRTC_ALLOW_STUN_ONLY: 'TRUE' }), /TURN is not configured/)
})

check('coturn HMAC credentials are random and short-lived', () => {
  const config = ice(turnEnv)
  const server = config.iceServers[1]
  assert.equal(config.turnConfigured, true)
  assert.equal(server.urls.length, 3)
  assert.equal(server.credential, createHmac('sha1', turnEnv.WEBRTC_TURN_SHARED_SECRET).update(server.username).digest('base64'))
  assert.equal(Number(server.username.split(':')[0]) * 1000, Date.parse(config.expiresAt))
  assert.ok(Date.parse(config.expiresAt) - Date.now() > 598000)
  assert.ok(Date.parse(config.expiresAt) - Date.now() <= 600000)
  assert.notEqual(server.username, ice(turnEnv).iceServers[1].username)
  assert.equal(JSON.stringify(config).includes(turnEnv.WEBRTC_TURN_SHARED_SECRET), false)
})

check('TURN lifetime clamps and relay configuration', () => {
  for (const [value, expected] of [['1', 60], ['9999', 3600]]) {
    const config = ice({ ...turnEnv, WEBRTC_TURN_TTL_SECONDS: value, WEBRTC_ICE_TRANSPORT_POLICY: 'relay' })
    assert.equal(config.iceTransportPolicy, 'relay')
    const lifetime = Date.parse(config.expiresAt) - Date.now()
    assert.ok(lifetime <= expected * 1000 && lifetime > (expected - 2) * 1000)
  }
  assert.throws(() => ice({ ...turnEnv, WEBRTC_TURN_TTL_SECONDS: 'invalid' }), /must be an integer/)
})

check('Invalid ICE configuration is rejected, not silently weakened', () => {
  for (const env of [
    { ...turnEnv, WEBRTC_TURN_SHARED_SECRET: '' },
    { ...turnEnv, WEBRTC_TURN_SHARED_SECRET: 'short' },
    { ...turnEnv, WEBRTC_STUN_URLS: 'https://example.com' },
    { ...turnEnv, WEBRTC_TURN_URLS: 'turn:turn.example.com?transport=invalid' },
    { ...turnEnv, WEBRTC_ICE_TRANSPORT_POLICY: 'realay' },
    { ...turnEnv, WEBRTC_STUN_URLS: Array.from({ length: 9 }, (_, i) => `stun:stun${i}.example.com`).join(',') },
  ]) {
    assert.throws(() => ice(env))
  }
})

console.log(`\n${passed} WebRTC helper test groups passed. Browser and database tests remain manual.`)
