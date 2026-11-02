import type { CaptureSessionPosition } from '@/lib/capture-session'

export const WEBRTC_SIGNAL_TYPES = [
  'offer',
  'answer',
  'ice',
  'restart',
] as const

export type RoomWebRtcSignalType = (typeof WEBRTC_SIGNAL_TYPES)[number]

export interface RoomWebRtcDescriptionPayload {
  sdp: string
}

export type RoomWebRtcIceCandidate = {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment?: string | null
}

export interface RoomWebRtcIcePayload {
  candidates: Array<RoomWebRtcIceCandidate | null>
}

export type RoomWebRtcSignalPayload =
  | RoomWebRtcDescriptionPayload
  | RoomWebRtcIcePayload
  | Record<string, never>

export interface RoomWebRtcInboxMessage {
  id: string
  revision: number
  senderGeneration: number
  sequence: number
  negotiationId: string
  type: RoomWebRtcSignalType
  payload: RoomWebRtcSignalPayload
  expiresAt: string
}

export interface RoomWebRtcLease {
  clientId: string
  generation: number
  position: CaptureSessionPosition
  nextSequence: number
  expiresAt: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MAX_SDP_LENGTH = 65_536
const MAX_ICE_CANDIDATES = 64
const MAX_ICE_CANDIDATE_LENGTH = 4_096
const MAX_SDP_MID_LENGTH = 256
const MAX_SIGNAL_NUMBER = 2_147_483_647

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function isPositiveSignalNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_SIGNAL_NUMBER
  )
}

export function isRoomWebRtcSignalType(
  value: unknown
): value is RoomWebRtcSignalType {
  return (
    typeof value === 'string' &&
    WEBRTC_SIGNAL_TYPES.includes(value as RoomWebRtcSignalType)
  )
}

function isNullableString(
  value: unknown,
  maximumLength: number
): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && value.length <= maximumLength)
  )
}

function parseIceCandidate(value: unknown): RoomWebRtcIceCandidate | null | false {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.candidate !== 'string' ||
    candidate.candidate.length === 0 ||
    candidate.candidate.length > MAX_ICE_CANDIDATE_LENGTH ||
    !isNullableString(candidate.sdpMid, MAX_SDP_MID_LENGTH) ||
    !(
      candidate.sdpMLineIndex === null ||
      (typeof candidate.sdpMLineIndex === 'number' &&
        Number.isInteger(candidate.sdpMLineIndex) &&
        candidate.sdpMLineIndex >= 0 &&
        candidate.sdpMLineIndex <= 65_535)
    ) ||
    !(
      candidate.usernameFragment === undefined ||
      isNullableString(candidate.usernameFragment, MAX_SDP_MID_LENGTH)
    )
  ) {
    return false
  }

  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    ...(candidate.usernameFragment === undefined
      ? {}
      : { usernameFragment: candidate.usernameFragment }),
  }
}

export function parseRoomWebRtcSignalPayload(
  type: RoomWebRtcSignalType,
  value: unknown
): RoomWebRtcSignalPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>

  if (type === 'offer' || type === 'answer') {
    if (
      typeof payload.sdp !== 'string' ||
      payload.sdp.length === 0 ||
      payload.sdp.length > MAX_SDP_LENGTH ||
      !payload.sdp.startsWith('v=0')
    ) {
      return null
    }

    return { sdp: payload.sdp }
  }

  if (type === 'ice') {
    if (
      !Array.isArray(payload.candidates) ||
      payload.candidates.length === 0 ||
      payload.candidates.length > MAX_ICE_CANDIDATES
    ) {
      return null
    }

    const candidates: Array<RoomWebRtcIceCandidate | null> = []
    for (const valueCandidate of payload.candidates) {
      const candidate = parseIceCandidate(valueCandidate)
      if (candidate === false) return null
      candidates.push(candidate)
    }

    return { candidates }
  }

  return Object.keys(payload).length === 0 ? {} : null
}

export function parseRoomWebRtcInboxMessage(
  value: unknown
): RoomWebRtcInboxMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const message = value as Record<string, unknown>

  if (
    !isUuid(message.id) ||
    !isPositiveSignalNumber(message.revision) ||
    !isPositiveSignalNumber(message.senderGeneration) ||
    !isPositiveSignalNumber(message.sequence) ||
    !isUuid(message.negotiationId) ||
    !isRoomWebRtcSignalType(message.type) ||
    typeof message.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(message.expiresAt))
  ) {
    return null
  }

  const payload = parseRoomWebRtcSignalPayload(message.type, message.payload)
  if (!payload) return null

  return {
    id: message.id,
    revision: message.revision,
    senderGeneration: message.senderGeneration,
    sequence: message.sequence,
    negotiationId: message.negotiationId,
    type: message.type,
    payload,
    expiresAt: message.expiresAt,
  }
}
