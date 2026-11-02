import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Evaluate the real helpers, route, and hook with isolated environments and
// mocked browser/DB boundaries. No .env, network, camera, or database access.
const require = createRequire(import.meta.url)
function loadSource(relativePath, { env = {}, mocks = {}, globals = {} } = {}) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url))
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  const compiledModule = { exports: {} }
  runInNewContext(outputText, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name]
      assert.ok(!name.startsWith('@/'), `Missing isolated dependency: ${name}`)
      return require(name)
    },
    process: { env },
    URL, Request, Response, TextDecoder, AbortController, DOMException, console,
    ...globals,
  }, { filename })
  return compiledModule.exports
}

let passed = 0
async function check(name, run) {
  await run()
  passed += 1
  console.log(`PASS ${name}`)
}

const tunnelHost = 'random-quick-tunnel.trycloudflare.com'
const tunnelOrigin = `https://${tunnelHost}`
const uuid = 'aabbccdd-1234-4234-8234-aabbccddeeff'
const claim = { action: 'claim', clientId: uuid, force: false }
function originPolicy(nodeEnv) {
  return loadSource('../src/lib/webrtc-origin.ts', {
    env: nodeEnv ? { NODE_ENV: nodeEnv } : {},
  }).hasValidWebRtcOrigin
}
function makeRequest(origin = tunnelOrigin, {
  url = 'https://localhost:3000/api/rooms/MOON-47/webrtc/signaling',
  host = tunnelHost,
  forwardedHost = tunnelHost,
  forwardedProto = 'https',
  contentType = 'application/json',
  body = claim,
} = {}) {
  const headers = new Headers()
  for (const [name, value] of [
    ['origin', origin], ['host', host], ['x-forwarded-host', forwardedHost],
    ['x-forwarded-proto', forwardedProto], ['content-type', contentType],
  ]) {
    if (value !== null) headers.set(name, value)
  }
  return new Request(url, {
    method: 'POST', headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const devOrigin = originPolicy('development')
await check('Exact same-origin and missing-Origin behavior is preserved in every environment', () => {
  for (const env of ['development', 'production', 'test', undefined]) {
    const valid = originPolicy(env)
    assert.equal(valid(makeRequest('https://localhost:3000')), true)
    assert.equal(valid(makeRequest(null)), true)
    assert.equal(valid(makeRequest('https://foreign.example')), false)
    assert.equal(valid(makeRequest('null')), false)
    assert.equal(valid(makeRequest('')), false)
  }
})

await check('Reproduced Next internal-URL/tunnel-Host mismatch is allowed only in development', () => {
  assert.equal(devOrigin(makeRequest()), true)
  assert.equal(devOrigin(makeRequest(tunnelOrigin, { forwardedHost: null })), true)
  assert.equal(devOrigin(makeRequest(tunnelOrigin, { host: tunnelHost.toUpperCase() })), true)
  assert.equal(devOrigin(makeRequest(tunnelOrigin, { host: `${tunnelHost}:443` })), true)
  for (const env of ['production', 'test', undefined]) {
    assert.equal(originPolicy(env)(makeRequest()), false)
  }
  for (const label of ['a', 'a'.repeat(63)]) {
    const host = `${label}.trycloudflare.com`
    assert.equal(devOrigin(makeRequest(`https://${host}`, { host, forwardedHost: host })), true)
  }
})

await check('Forwarded tunnel authority is accepted only through the matching local backend', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
    assert.equal(devOrigin(makeRequest(tunnelOrigin, { host })), true)
  }
  for (const host of ['localhost:3001', 'foreign.example:3000', null]) {
    assert.equal(devOrigin(makeRequest(tunnelOrigin, { host })), false)
  }
  assert.equal(devOrigin(makeRequest(tunnelOrigin, { host: 'localhost:3000', forwardedHost: null })), false)
})

await check('Exact Quick Tunnel domain boundary rejects malicious lookalikes and invalid labels', () => {
  for (const host of [
    'trycloudflare.com', 'eviltrycloudflare.com', 'not-trycloudflare.com',
    'trycloudflare.com.evil.example', `${tunnelHost}.evil.example`,
    `${tunnelHost}.`, 'nested.random.trycloudflare.com',
    '-evil.trycloudflare.com', 'evil-.trycloudflare.com',
    'evil_name.trycloudflare.com', `${'a'.repeat(64)}.trycloudflare.com`,
  ]) {
    assert.equal(devOrigin(makeRequest(`https://${host}`, { host, forwardedHost: host })), false, host)
  }
})

await check('HTTPS-only canonical origins reject credentials, paths, ports, encodings, and origin lists', () => {
  for (const origin of [
    `http://${tunnelHost}`, `ftp://${tunnelHost}`, `${tunnelOrigin}:8443`,
    `${tunnelOrigin}:443`, `https://evil.example@${tunnelHost}`,
    `https://${tunnelHost}@evil.example`, `${tunnelOrigin}/`,
    `${tunnelOrigin}/path`, `${tunnelOrigin}?query`, `${tunnelOrigin}#fragment`,
    `${tunnelOrigin} https://evil.example`, `${tunnelOrigin}, https://evil.example`,
    'https://random%2dquick-tunnel.trycloudflare.com',
    `https:\\${tunnelHost}`, 'https://', 'data:text/plain,opaque', 'not-a-url',
  ]) {
    assert.equal(devOrigin(makeRequest(origin)), false, origin)
  }
})

await check('Conflicting, spoofed, malformed, and multi-valued forwarding headers fail closed', () => {
  const otherHost = 'another-tunnel.trycloudflare.com'
  assert.equal(devOrigin(makeRequest(`https://${otherHost}`, { forwardedHost: otherHost })), false)
  for (const forwardedHost of [
    otherHost, `${tunnelHost}, ${otherHost}`, `https://${tunnelHost}`,
    `evil.example@${tunnelHost}`, `${tunnelHost}/`, `${tunnelHost}:8443`,
    'random%2dquick-tunnel.trycloudflare.com', '',
  ]) {
    assert.equal(devOrigin(makeRequest(tunnelOrigin, { forwardedHost })), false, forwardedHost)
  }
  for (const host of ['foreign.example', `https://${tunnelHost}`, `${tunnelHost}, localhost`, `${tunnelHost}:8443`]) {
    assert.equal(devOrigin(makeRequest(tunnelOrigin, { host })), false, host)
  }
  for (const forwardedProto of [null, 'http', 'http, https', 'https, http', 'HTTPS', '']) {
    assert.equal(devOrigin(makeRequest(tunnelOrigin, { forwardedProto })), false)
  }
})

await check('Production trusts only request.url, not attacker-controlled forwarding headers or dev config', () => {
  const valid = originPolicy('production')
  assert.equal(valid(makeRequest()), false)
  assert.equal(valid(makeRequest('https://photobooth.example', {
    url: 'https://photobooth.example/api/rooms/MOON-47/webrtc/signaling',
    host: 'evil.example', forwardedHost: 'evil.example',
  })), true)
  const devConfig = loadSource('../next.config.ts', { env: { NODE_ENV: 'development' } }).default
  const prodConfig = loadSource('../next.config.ts', { env: { NODE_ENV: 'production' } }).default
  assert.ok(devConfig.allowedDevOrigins.includes('*.trycloudflare.com'))
  assert.equal(prodConfig.allowedDevOrigins, undefined)
})

const signaling = loadSource('../src/lib/webrtc-signaling.ts')
const { hashCapability } = loadSource('../src/lib/capability.ts')
const testCapability = 'c'.repeat(43)
function loadRoute({ env = 'development', capability = null, authorized = true, rpcError = null } = {}) {
  const calls = { cookie: 0, auth: [], rpc: [], member: 0 }
  const logs = []
  const route = loadSource('../src/app/api/rooms/[code]/webrtc/signaling/route.ts', {
    env: { NODE_ENV: env },
    mocks: {
      'next/server': { NextResponse: Response },
      'next/headers': { cookies: async () => ({ get: (name) => {
        assert.equal(name, 'session_capability')
        calls.cookie += 1
        return capability ? { value: capability } : undefined
      } }) },
      '@/lib/capability': { hashCapability },
      '@/lib/capture-session': { isCaptureSessionPosition: (value) => value === 'A' || value === 'B' },
      '@/lib/room-validation': { authorizeRoomCapability: async (...args) => {
        calls.auth.push(args)
        return authorized ? { roomState: 'active', finalization: null } : null
      } },
      '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async (...args) => {
        calls.rpc.push(args)
        return {
          error: rpcError,
          data: [{ client_generation: 1, last_signal_sequence: 0,
            client_lease_expires_at: new Date(Date.now() + 45000).toISOString(),
            participant_position: 'A' }],
        }
      } }) },
      '@/lib/webrtc-origin': { hasValidWebRtcOrigin: originPolicy(env) },
      '@/lib/webrtc-server': { getActiveWebRtcMember: async () => { calls.member += 1; return null } },
      '@/lib/webrtc-signaling': signaling,
    },
    globals: { console: { warn: (...args) => logs.push(args), error: assert.fail } },
  })
  return { route, calls, logs }
}
const context = { params: Promise.resolve({ code: 'MOON-47' }) }

await check('Rejected signaling POST returns exact 403/code before cookies, authorization, or DB', async () => {
  const { route, calls, logs } = loadRoute({ capability: testCapability })
  const response = await route.POST(makeRequest('https://evil.example'), context)
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'Request origin is not allowed', code: 'origin_not_allowed' })
  assert.deepEqual(calls, { cookie: 0, auth: [], rpc: [], member: 0 })
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.ok(response.headers.get('cache-control').includes('no-store'))
  assert.equal(logs.length, 1)
  assert.equal(logs[0][1].requestOrigin, 'https://localhost:3000')
  assert.equal(logs[0][1].host, tunnelHost)
  assert.equal(logs[0][1].forwardedHost, tunnelHost)
  assert.equal(JSON.stringify(logs).includes(testCapability), false)
  const production = loadRoute({ env: 'production' })
  assert.equal((await production.route.POST(makeRequest(), context)).status, 403)
  assert.equal(production.logs.length, 0)
})

await check('Accepted tunnel origins do not bypass missing/invalid capability or participant authorization', async () => {
  const missing = loadRoute()
  assert.equal((await missing.route.POST(makeRequest(), context)).status, 401)
  assert.equal(missing.calls.cookie, 1)
  assert.equal(missing.calls.rpc.length, 0)
  const invalid = loadRoute({ capability: testCapability, authorized: false })
  assert.equal((await invalid.route.POST(makeRequest(), context)).status, 401)
  assert.deepEqual(invalid.calls.auth, [['MOON-47', testCapability]])
  assert.equal(invalid.calls.rpc.length, 0)
  const unauthorizedMember = loadRoute({ capability: testCapability })
  assert.equal((await unauthorizedMember.route.POST(makeRequest(tunnelOrigin, {
    body: { action: 'signal', clientId: uuid, generation: 1 },
  }), context)).status, 409)
  assert.equal(unauthorizedMember.calls.member, 1)
  assert.equal(unauthorizedMember.calls.rpc.length, 0)
})

await check('Allowed claim retains capability hashing, server-derived roles, JSON/size limits, and DB denial', async () => {
  const allowed = loadRoute({ capability: testCapability })
  const response = await allowed.route.POST(makeRequest(), context)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).position, 'A')
  assert.equal(allowed.calls.rpc[0][0], 'claim_webrtc_client')
  assert.equal(allowed.calls.rpc[0][1].p_capability_hash, hashCapability(testCapability))
  assert.equal(allowed.calls.rpc[0][1].p_client_id, uuid)
  assert.equal(JSON.stringify(allowed.calls.rpc).includes(testCapability), false)
  const invalidJson = loadRoute({ capability: testCapability })
  assert.equal((await invalidJson.route.POST(makeRequest(tunnelOrigin, { contentType: 'text/plain' }), context)).status, 400)
  assert.equal((await invalidJson.route.POST(makeRequest(tunnelOrigin, { body: 'x'.repeat(110 * 1024 + 1) }), context)).status, 413)
  assert.equal(invalidJson.calls.cookie, 0)
  const denied = loadRoute({ capability: testCapability, rpcError: { message: 'room_access_denied' } })
  assert.equal((await denied.route.POST(makeRequest(), context)).status, 401)
})

// Minimal deterministic hook driver. Effects/dependencies and asynchronous
// requests run, but timers/media/peers are fakes; never touch a device camera.
function hookDriver(blockedAction, withInboxMessage = false) {
  const slots = []
  let cursor = 0
  let dirty = false
  let effects = []
  let current
  const calls = []
  const peers = []
  const timers = new Map()
  const listeners = new Map()
  let timerId = 0
  let stoppedTracks = 0
  const depsChanged = (previous, next) => !previous || next.some((value, index) => value !== previous[index])
  const react = {
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: initial }
      return [slots[index].value, (next) => {
        const value = typeof next === 'function' ? next(slots[index].value) : next
        if (value !== slots[index].value) { slots[index].value = value; dirty = true }
      }]
    },
    useRef(initial) {
      const index = cursor++
      slots[index] ??= { value: { current: initial } }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      if (depsChanged(slots[index]?.deps, deps)) slots[index] = { deps, value: callback }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      if (!depsChanged(slots[index]?.deps, deps)) return
      const previous = slots[index]
      slots[index] = { deps }
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect() })
    },
  }
  const browser = {
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay, interval: false }); return id },
    setInterval: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay, interval: true }); return id },
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    addEventListener: (name, callback) => { listeners.set(name, [...(listeners.get(name) ?? []), callback]) },
    removeEventListener: (name, callback) => { listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== callback)) },
    visibilityState: 'visible',
  }
  class FakePeer {
    constructor() { this.signalingState = 'stable'; this.connectionState = 'new'; peers.push(this) }
    addTrack() {}
    close() { this.signalingState = 'closed'; this.connectionState = 'closed' }
  }
  const track = { readyState: 'live', stop: () => { stoppedTracks += 1 } }
  const localStream = { getVideoTracks: () => [track], getTracks: () => [track] }
  const { useRoomWebRtc } = loadSource('../src/hooks/use-room-webrtc.ts', {
    mocks: {
      react,
      '@/lib/capture-session': { isCaptureSessionPosition: (value) => value === 'A' || value === 'B' },
      '@/lib/webrtc-signaling': signaling,
    },
    globals: {
      window: browser, document: browser, navigator: {},
      performance: { getEntriesByType: () => [] },
      crypto: { randomUUID: () => uuid }, RTCPeerConnection: FakePeer,
      setTimeout: browser.setTimeout, clearTimeout: browser.clearTimeout,
      fetch: async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null
        calls.push({ url, body })
        if (body?.action === blockedAction) {
          return Response.json({ error: 'Request origin is not allowed', code: 'origin_not_allowed' }, { status: 403 })
        }
        if (url.endsWith('/capture-session')) return Response.json({ session: { participantPosition: 'B' } })
        if (body?.action === 'claim') return Response.json({ generation: 1, nextSequence: 1, position: 'B', expiresAt: new Date(Date.now() + 45000).toISOString() })
        if (url.endsWith('/ice')) return Response.json({ iceServers: [], iceTransportPolicy: 'all', expiresAt: null, turnConfigured: false })
        if (body?.action === 'heartbeat') return Response.json({ expiresAt: new Date(Date.now() + 45000).toISOString() })
        if (body) return Response.json({})
        return Response.json({ revision: withInboxMessage ? 1 : 0, hasMore: false, messages: withInboxMessage ? [{
          id: uuid, revision: 1, senderGeneration: 1, sequence: 1,
          negotiationId: uuid, type: 'restart', payload: {},
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        }] : [] })
      },
    },
  })
  function TestRoomWebRtc() {
    cursor = 0
    dirty = false
    effects = []
    current = useRoomWebRtc({ roomCode: 'MOON-47', roomActive: true, enabled: true,
      localStream, signalingSignalVersion: 0, subscriptionVersion: 0 })
    effects.forEach((effect) => effect())
  }
  async function settle() {
    for (let tick = 0; tick < 100; tick += 1) {
      await Promise.resolve()
      if (dirty) TestRoomWebRtc()
    }
  }
  TestRoomWebRtc()
  return {
    calls, peers, timers, settle,
    get current() { return current },
    get stoppedTracks() { return stoppedTracks },
    unblock: () => { blockedAction = null },
    dispatch: (name) => { listeners.get(name)?.forEach((listener) => listener()) },
  }
}

for (const action of ['claim', 'signal', 'ack', 'heartbeat']) {
  await check(`Origin rejection during ${action} is terminal, not an automatic reconnect/retry loop`, async () => {
    const driver = hookDriver(action, action === 'ack')
    await driver.settle()
    if (action === 'heartbeat') {
      const heartbeat = [...driver.timers.values()].find((timer) => timer.interval && timer.delay === 15000)
      assert.ok(heartbeat)
      heartbeat.callback()
      await driver.settle()
    }
    assert.equal(driver.current.status, 'disconnected')
    assert.equal(driver.current.error.code, 'configuration')
    assert.ok(driver.current.error.message.includes('Request origin is not allowed'))
    assert.equal(driver.calls.filter((call) => call.body?.action === action).length, 1)
    assert.ok(driver.peers.every((peer) => peer.signalingState === 'closed'))
    assert.equal(driver.timers.size, 0)
    assert.equal(driver.stoppedTracks, 0)
    const requestCount = driver.calls.length
    driver.dispatch('online')
    driver.dispatch('focus')
    driver.dispatch('visibilitychange')
    await driver.settle()
    assert.equal(driver.calls.length, requestCount)
    driver.unblock()
    driver.current.reconnect()
    await driver.settle()
    assert.equal(driver.current.status, 'connecting')
    assert.equal(driver.current.error, null)
    assert.equal(driver.calls.filter((call) => call.body?.action === 'claim').at(-1).body.force, true)
    assert.equal(driver.stoppedTracks, 0)
  })
}

console.log(`\n${passed} WebRTC origin/route/recovery test groups passed. Physical-device/TURN tests remain manual.`)
