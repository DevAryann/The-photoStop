import { createHmac, randomBytes } from 'crypto'

export interface ProtectedIceConfiguration {
  iceServers: RTCIceServer[]
  iceTransportPolicy: RTCIceTransportPolicy
  expiresAt: string | null
  turnConfigured: boolean
}

const MAX_ICE_URLS = 8
const DEFAULT_TURN_TTL_SECONDS = 600
const MIN_TURN_TTL_SECONDS = 60
const MAX_TURN_TTL_SECONDS = 3600

function parseUrlList(value: string | undefined) {
  return Array.from(
    new Set(
      (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  )
}

function isStunUrl(value: string) {
  return /^stuns?:[^\s,?]{1,500}$/i.test(value)
}

function isTurnUrl(value: string) {
  return /^turns?:[^\s,?]{1,500}(?:\?transport=(?:udp|tcp))?$/i.test(value)
}

function parseTurnTtl(value: string | undefined) {
  if (!value) return DEFAULT_TURN_TTL_SECONDS
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error('WEBRTC_TURN_TTL_SECONDS must be an integer')
  }

  return Math.min(
    Math.max(parsed, MIN_TURN_TTL_SECONDS),
    MAX_TURN_TTL_SECONDS
  )
}

/**
 * Build a browser-safe ICE configuration from server-only environment values.
 *
 * TURN credentials use coturn's documented REST shared-secret scheme:
 * username = "<unix-expiry>:<random-id>"
 * credential = base64(HMAC-SHA1(shared-secret, username))
 */
export function createProtectedIceConfiguration(): ProtectedIceConfiguration {
  const stunUrls = parseUrlList(process.env.WEBRTC_STUN_URLS)
  const turnUrls = parseUrlList(process.env.WEBRTC_TURN_URLS)
  const turnSecret = process.env.WEBRTC_TURN_SHARED_SECRET?.trim()
  const allowStunOnly = process.env.WEBRTC_ALLOW_STUN_ONLY === 'true'
  const configuredPolicy = process.env.WEBRTC_ICE_TRANSPORT_POLICY
  if (configuredPolicy && configuredPolicy !== 'all' && configuredPolicy !== 'relay') {
    throw new Error('WEBRTC_ICE_TRANSPORT_POLICY must be all or relay')
  }
  const iceTransportPolicy: RTCIceTransportPolicy =
    configuredPolicy === 'relay' ? 'relay' : 'all'

  if (
    stunUrls.length > MAX_ICE_URLS ||
    turnUrls.length > MAX_ICE_URLS ||
    stunUrls.some((url) => !isStunUrl(url)) ||
    turnUrls.some((url) => !isTurnUrl(url))
  ) {
    throw new Error('Invalid WebRTC STUN or TURN URL configuration')
  }

  if ((turnUrls.length > 0) !== Boolean(turnSecret)) {
    throw new Error(
      'WEBRTC_TURN_URLS and WEBRTC_TURN_SHARED_SECRET must be configured together'
    )
  }

  if (turnSecret && turnSecret.length < 16) {
    throw new Error('WEBRTC_TURN_SHARED_SECRET is too short')
  }

  if (turnUrls.length === 0 && !allowStunOnly) {
    throw new Error(
      'TURN is not configured and the explicit STUN-only fallback is disabled'
    )
  }

  if (iceTransportPolicy === 'relay' && turnUrls.length === 0) {
    throw new Error('Relay-only mode requires a configured TURN server')
  }

  if (stunUrls.length === 0 && turnUrls.length === 0) {
    throw new Error('At least one STUN or TURN URL must be configured')
  }

  const iceServers: RTCIceServer[] = []
  if (stunUrls.length > 0) iceServers.push({ urls: stunUrls })

  if (!turnSecret || turnUrls.length === 0) {
    return {
      iceServers,
      iceTransportPolicy,
      expiresAt: null,
      turnConfigured: false,
    }
  }

  const ttlSeconds = parseTurnTtl(process.env.WEBRTC_TURN_TTL_SECONDS)
  const expiryUnix = Math.floor(Date.now() / 1000) + ttlSeconds
  const username = `${expiryUnix}:${randomBytes(12).toString('base64url')}`
  const credential = createHmac('sha1', turnSecret)
    .update(username)
    .digest('base64')

  iceServers.push({
    urls: turnUrls,
    username,
    credential,
  })

  return {
    iceServers,
    iceTransportPolicy,
    expiresAt: new Date(expiryUnix * 1000).toISOString(),
    turnConfigured: true,
  }
}
