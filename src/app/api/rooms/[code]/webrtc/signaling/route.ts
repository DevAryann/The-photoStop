import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { hashCapability } from '@/lib/capability'
import { isCaptureSessionPosition } from '@/lib/capture-session'
import { authorizeRoomCapability } from '@/lib/room-validation'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasValidWebRtcOrigin } from '@/lib/webrtc-origin'
import { getActiveWebRtcMember } from '@/lib/webrtc-server'
import {
  isPositiveSignalNumber,
  isRoomWebRtcSignalType,
  isUuid,
  parseRoomWebRtcInboxMessage,
  parseRoomWebRtcSignalPayload,
} from '@/lib/webrtc-signaling'

interface RouteContext {
  params: Promise<{ code: string }>
}

const MAX_REQUEST_BYTES = 110 * 1024
const MAX_ACKNOWLEDGEMENTS = 100
const MAX_INBOX_MESSAGES = 25
const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

function jsonNoStore(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> }
) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: { ...noStoreHeaders, ...init?.headers },
  })
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new Error('unsupported_content_type')
  }

  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new Error('payload_too_large')
  }

  if (!request.body) throw new Error('invalid_json')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel()
        throw new Error('payload_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('invalid_json')
  }
}

function parseGeneration(value: unknown) {
  return isPositiveSignalNumber(value) ? value : null
}

function parseDatabaseNumber(value: unknown) {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isSafeInteger(parsed)
    ? parsed
    : null
}

async function authorizeRequest(code: string) {
  const cookieStore = await cookies()
  const capability = cookieStore.get('session_capability')?.value
  const access = capability
    ? await authorizeRoomCapability(code, capability)
    : null
  return { access, capability }
}

function leaseLostResponse() {
  return jsonNoStore(
    {
      error:
        'This camera connection is no longer active. Reconnect to continue.',
      code: 'client_lease_lost',
    },
    { status: 409 }
  )
}

/**
 * Read the protected recipient inbox. Realtime notifications are only hints;
 * this authoritative read recovers every unexpired, unacknowledged message.
 */
export async function GET(request: Request, context: RouteContext) {
  const { code } = await context.params
  const { access } = await authorizeRequest(code)
  if (!access) {
    return jsonNoStore(
      { error: 'Room access is unavailable', code: 'room_access_denied' },
      { status: 401 }
    )
  }

  if (access.roomState !== 'active' || access.finalization) {
    return jsonNoStore(
      { error: 'Live camera sharing is no longer available in this room.', code: 'room_access_denied' },
      { status: 401 }
    )
  }

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  const generationValue = Number(url.searchParams.get('generation'))
  const generation = parseGeneration(generationValue)
  if (!isUuid(clientId) || generation === null) {
    return jsonNoStore({ error: 'Invalid signaling request' }, { status: 400 })
  }

  const member = await getActiveWebRtcMember(access, clientId, generation)
  if (!member) return leaseLostResponse()

  const supabase = createAdminClient()
  const now = new Date().toISOString()

  // Opportunistic expiry cleanup keeps abandoned inboxes bounded without
  // requiring browser access or relying on Realtime delivery.
  const { error: cleanupError } = await supabase
    .from('webrtc_signaling_messages')
    .delete()
    .eq('session_id', member.sessionId)
    .lte('expires_at', now)
  if (cleanupError) {
    console.error('[WebRTC Signaling] Expiry cleanup failed:', cleanupError)
  }

  const [inboxResult, messageResult] = await Promise.all([
    supabase
      .from('webrtc_signaling_inboxes')
      .select('revision')
      .eq('session_id', member.sessionId)
      .eq('participant_id', member.participantId)
      .maybeSingle(),
    supabase
      .from('webrtc_signaling_messages')
      .select(
        'opaque_id, inbox_revision, sender_generation, sequence, negotiation_id, message_type, payload, expires_at'
      )
      .eq('session_id', member.sessionId)
      .eq('recipient_participant_id', member.participantId)
      .is('acknowledged_at', null)
      .gt('expires_at', now)
      .order('inbox_revision', { ascending: true })
      .limit(MAX_INBOX_MESSAGES + 1),
  ])

  if (inboxResult.error || messageResult.error) {
    console.error(
      '[WebRTC Signaling] Inbox read failed:',
      inboxResult.error ?? messageResult.error
    )
    return jsonNoStore(
      { error: 'The camera connection could not be synchronized.' },
      { status: 503 }
    )
  }

  const rows = messageResult.data ?? []
  const hasMore = rows.length > MAX_INBOX_MESSAGES
  const messages = rows.slice(0, MAX_INBOX_MESSAGES).map((row) =>
    parseRoomWebRtcInboxMessage({
      id: row.opaque_id,
      revision: parseDatabaseNumber(row.inbox_revision),
      senderGeneration: parseDatabaseNumber(row.sender_generation),
      sequence: parseDatabaseNumber(row.sequence),
      negotiationId: row.negotiation_id,
      type: row.message_type,
      payload: row.payload,
      expiresAt: row.expires_at,
    })
  )

  if (messages.some((message) => message === null)) {
    console.error('[WebRTC Signaling] Invalid message found in protected inbox')
    return jsonNoStore(
      { error: 'The camera connection could not be synchronized.' },
      { status: 503 }
    )
  }

  return jsonNoStore({
    revision: parseDatabaseNumber(inboxResult.data?.revision) ?? 0,
    messages,
    hasMore,
  })
}

/**
 * Claim/renew/release the active generation, acknowledge protected messages, or
 * enqueue one validated signal to the server-derived other room member.
 */
export async function POST(request: Request, context: RouteContext) {
  if (!hasValidWebRtcOrigin(request)) {
    if (process.env.NODE_ENV === 'development') {
      // Header-only diagnostics: never log cookies, SDP, ICE, or request bodies.
      console.warn('[WebRTC Signaling] Origin rejected:', {
        origin: request.headers.get('origin')?.slice(0, 200) ?? null,
        requestOrigin: new URL(request.url).origin,
        host: request.headers.get('host')?.slice(0, 200) ?? null,
        forwardedHost: request.headers.get('x-forwarded-host')?.slice(0, 200) ?? null,
        forwardedProto: request.headers.get('x-forwarded-proto')?.slice(0, 200) ?? null,
      })
    }
    return jsonNoStore(
      { error: 'Request origin is not allowed', code: 'origin_not_allowed' },
      { status: 403 }
    )
  }

  let body: unknown
  try {
    body = await readLimitedJson(request)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid_json'
    return jsonNoStore(
      {
        error:
          reason === 'payload_too_large'
            ? 'Signaling payload is too large'
            : reason === 'unsupported_content_type'
              ? 'Content-Type must be application/json'
              : 'Invalid signaling request',
      },
      { status: reason === 'payload_too_large' ? 413 : 400 }
    )
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonNoStore({ error: 'Invalid signaling request' }, { status: 400 })
  }

  const input = body as Record<string, unknown>
  const action = input.action
  const clientId = input.clientId
  if (
    (action !== 'claim' &&
      action !== 'heartbeat' &&
      action !== 'release' &&
      action !== 'ack' &&
      action !== 'signal') ||
    !isUuid(clientId)
  ) {
    return jsonNoStore({ error: 'Invalid signaling request' }, { status: 400 })
  }

  const { code } = await context.params
  const { access, capability } = await authorizeRequest(code)
  if (!access || !capability) {
    return jsonNoStore(
      { error: 'Room access is unavailable', code: 'room_access_denied' },
      { status: 401 }
    )
  }

  if (action !== 'release' && (access.roomState !== 'active' || access.finalization)) {
    return jsonNoStore(
      { error: 'Live camera sharing is no longer available in this room.', code: 'room_access_denied' },
      { status: 401 }
    )
  }

  const supabase = createAdminClient()
  const capabilityHash = hashCapability(capability)

  if (action === 'claim') {
    if (input.force !== undefined && typeof input.force !== 'boolean') {
      return jsonNoStore({ error: 'Invalid signaling request' }, { status: 400 })
    }

    const { data, error } = await supabase.rpc('claim_webrtc_client', {
      p_room_code: code,
      p_capability_hash: capabilityHash,
      p_client_id: clientId,
      p_force: input.force === true,
    })

    if (error) {
      if (error.message?.includes('webrtc_client_lease_active')) {
        return jsonNoStore(
          {
            error:
              'Your camera is already active in another tab. Close it there, or choose “Use this tab”.',
            code: 'client_lease_active',
          },
          { status: 409 }
        )
      }
      if (error.message?.includes('capture_session_required')) {
        return jsonNoStore(
          { error: 'The paired camera session is not ready yet.' },
          { status: 409 }
        )
      }
      if (error.message?.includes('room_access_denied')) {
        return jsonNoStore(
          { error: 'Room access is unavailable', code: 'room_access_denied' },
          { status: 401 }
        )
      }

      console.error('[WebRTC Signaling] Lease claim failed:', error)
      return jsonNoStore(
        { error: 'The camera connection could not be started.' },
        { status: 503 }
      )
    }

    const row = data?.[0]
    const generation = parseDatabaseNumber(row?.client_generation)
    const lastSequence = parseDatabaseNumber(row?.last_signal_sequence)
    if (
      generation === null ||
      generation <= 0 ||
      lastSequence === null ||
      lastSequence < 0 ||
      typeof row?.client_lease_expires_at !== 'string' ||
      !isCaptureSessionPosition(row?.participant_position)
    ) {
      console.error('[WebRTC Signaling] Invalid lease claim response')
      return jsonNoStore(
        { error: 'The camera connection could not be started.' },
        { status: 503 }
      )
    }

    return jsonNoStore({
      generation,
      expiresAt: row.client_lease_expires_at,
      nextSequence: lastSequence + 1,
      position: row.participant_position,
    })
  }

  const generation = parseGeneration(input.generation)
  if (generation === null) {
    return jsonNoStore({ error: 'Invalid signaling request' }, { status: 400 })
  }

  if (action === 'release') {
    const { error } = await supabase.rpc('release_webrtc_client', {
      p_room_code: code,
      p_capability_hash: capabilityHash,
      p_client_id: clientId,
      p_generation: generation,
    })
    if (error && !error.message?.includes('room_access_denied')) {
      console.error('[WebRTC Signaling] Lease release failed:', error)
    }
    return new NextResponse(null, { status: 204, headers: noStoreHeaders })
  }

  if (action === 'heartbeat') {
    const { data, error } = await supabase.rpc('renew_webrtc_client', {
      p_room_code: code,
      p_capability_hash: capabilityHash,
      p_client_id: clientId,
      p_generation: generation,
    })
    if (error) {
      if (error.message?.includes('room_access_denied')) {
        return jsonNoStore({ error: 'Room access is unavailable', code: 'room_access_denied' }, { status: 401 })
      }
      if (error.message?.includes('webrtc_client_lease_lost')) {
        return leaseLostResponse()
      }
      console.error('[WebRTC Signaling] Heartbeat failed:', error)
      return jsonNoStore(
        { error: 'The camera connection could not be renewed.' },
        { status: 503 }
      )
    }

    return jsonNoStore({ expiresAt: data?.[0]?.client_lease_expires_at })
  }

  const member = await getActiveWebRtcMember(access, clientId, generation)
  if (!member) return leaseLostResponse()

  if (action === 'ack') {
    if (
      !Array.isArray(input.messageIds) ||
      input.messageIds.length === 0 ||
      input.messageIds.length > MAX_ACKNOWLEDGEMENTS ||
      input.messageIds.some((id) => !isUuid(id))
    ) {
      return jsonNoStore({ error: 'Invalid acknowledgements' }, { status: 400 })
    }

    const messageIds = Array.from(new Set(input.messageIds as string[]))
    const { error } = await supabase.rpc('acknowledge_webrtc_signals', {
      p_room_code: code,
      p_capability_hash: capabilityHash,
      p_client_id: clientId,
      p_generation: generation,
      p_message_ids: messageIds,
    })

    if (error) {
      if (error.message?.includes('room_access_denied')) {
        return jsonNoStore({ error: 'Room access is unavailable', code: 'room_access_denied' }, { status: 401 })
      }
      if (error.message?.includes('webrtc_client_lease_lost')) {
        return leaseLostResponse()
      }
      console.error('[WebRTC Signaling] Acknowledgement failed:', error)
      return jsonNoStore(
        { error: 'The camera connection could not be synchronized.' },
        { status: 503 }
      )
    }

    return jsonNoStore({ acknowledged: true })
  }

  const sequence = parseGeneration(input.sequence)
  const negotiationId = input.negotiationId
  const type = input.type
  if (
    sequence === null ||
    !isUuid(negotiationId) ||
    !isRoomWebRtcSignalType(type)
  ) {
    return jsonNoStore({ error: 'Invalid signaling message' }, { status: 400 })
  }

  const payload = parseRoomWebRtcSignalPayload(type, input.payload)
  if (!payload) {
    return jsonNoStore({ error: 'Invalid signaling payload' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('enqueue_webrtc_signal', {
    p_room_code: code,
    p_capability_hash: capabilityHash,
    p_client_id: clientId,
    p_generation: generation,
    p_sequence: sequence,
    p_negotiation_id: negotiationId,
    p_message_type: type,
    p_payload: payload,
  })

  if (error) {
    if (error.message?.includes('room_access_denied')) {
      return jsonNoStore({ error: 'Room access is unavailable', code: 'room_access_denied' }, { status: 401 })
    }
    if (error.message?.includes('webrtc_client_lease_lost')) {
      return leaseLostResponse()
    }
    if (error.message?.includes('webrtc_signal_rate_limited')) {
      return jsonNoStore(
        {
          error: 'The camera connection is sending too quickly. Please retry.',
          code: 'rate_limited',
        },
        { status: 429, headers: { 'Retry-After': '2' } }
      )
    }
    if (error.message?.includes('webrtc_signal_inbox_full')) {
      return jsonNoStore(
        { error: 'The partner connection is catching up. Please retry.' },
        { status: 429, headers: { 'Retry-After': '2' } }
      )
    }
    if (
      error.message?.includes('webrtc_signal_sequence') ||
      error.message?.includes('webrtc_signal_invalid')
    ) {
      return jsonNoStore(
        { error: 'The signaling sequence is stale. Reconnect to continue.' },
        { status: 409 }
      )
    }

    console.error('[WebRTC Signaling] Enqueue failed:', error)
    return jsonNoStore(
      { error: 'The camera connection could not be synchronized.' },
      { status: 503 }
    )
  }

  const row = data?.[0]
  const revision = parseDatabaseNumber(row?.recipient_inbox_revision)
  if (
    !isUuid(row?.message_opaque_id) ||
    revision === null ||
    revision <= 0 ||
    typeof row?.message_expires_at !== 'string' ||
    typeof row?.was_deduplicated !== 'boolean'
  ) {
    console.error('[WebRTC Signaling] Invalid enqueue response')
    return jsonNoStore(
      { error: 'The camera connection could not be synchronized.' },
      { status: 503 }
    )
  }

  // This public-channel payload is deliberately opaque. Both subscribers may
  // receive it, but only the capability-protected recipient can read the inbox.
  try {
    const channel = supabase.channel(`room:${code}`)
    await channel.send({
      type: 'broadcast',
      event: 'signal_revision',
      payload: { revision },
    })
    await supabase.removeChannel(channel)
  } catch (broadcastError) {
    // Protected polling recovers missed notifications.
    console.error('[WebRTC Signaling] Revision broadcast failed:', broadcastError)
  }

  return jsonNoStore(
    {
      messageId: row.message_opaque_id,
      revision,
      expiresAt: row.message_expires_at,
      deduplicated: row.was_deduplicated,
    },
    { status: row.was_deduplicated ? 200 : 201 }
  )
}
