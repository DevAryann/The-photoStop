import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { hashCapability } from '@/lib/capability'
import {
  broadcastCaptureState,
  loadSynchronizedCaptureState,
} from '@/lib/capture-session-server'
import { readJpegDimensions } from '@/lib/jpeg'
import { authorizeRoomCapability } from '@/lib/room-validation'
import { MAX_SHARED_PHOTO_BYTES, SHARED_PHOTO_BUCKET } from '@/lib/shared-photos'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasValidWebRtcOrigin } from '@/lib/webrtc-origin'
import { getActiveWebRtcMember } from '@/lib/webrtc-server'
import { isPositiveSignalNumber, isUuid } from '@/lib/webrtc-signaling'

interface RouteContext {
  params: Promise<{ code: string }>
}

const noStoreHeaders = { 'Cache-Control': 'no-store, private' }

function jsonNoStore(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { ...init, headers: noStoreHeaders })
}

async function authorizeCaptureRequest(code: string) {
  const cookieStore = await cookies()
  const capability = cookieStore.get('session_capability')?.value
  const access = capability
    ? await authorizeRoomCapability(code, capability)
    : null
  return access && capability ? { access, capability } : null
}

function parseBaseBody(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const body = value as {
    attemptId?: unknown
    clientId?: unknown
    generation?: unknown
  }
  if (
    !isUuid(body.attemptId) ||
    !isUuid(body.clientId) ||
    !isPositiveSignalNumber(body.generation)
  ) {
    return null
  }
  return {
    attemptId: body.attemptId,
    clientId: body.clientId,
    generation: body.generation,
  }
}

async function readJson(request: Request) {
  if (!hasValidWebRtcOrigin(request)) {
    return { error: jsonNoStore({ error: 'Request origin is not allowed' }, { status: 403 }) }
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return { error: jsonNoStore({ error: 'JSON is required' }, { status: 415 }) }
  }
  try {
    return { body: await request.json() as unknown }
  } catch {
    return { error: jsonNoStore({ error: 'Invalid image request' }, { status: 400 }) }
  }
}

async function findOwnedImage(
  sessionId: string,
  participantId: string,
  attemptOpaqueId: string
) {
  const supabase = createAdminClient()
  const { data: attempt, error: attemptError } = await supabase
    .from('capture_attempts')
    .select('id, result_state')
    .eq('session_id', sessionId)
    .eq('opaque_id', attemptOpaqueId)
    .maybeSingle()
  if (
    attemptError ||
    !attempt ||
    (attempt.result_state !== 'pending' &&
      attempt.result_state !== 'partial' &&
      attempt.result_state !== 'complete')
  ) {
    return null
  }

  const { data: image, error: imageError } = await supabase
    .from('capture_images')
    .select('id, storage_path, upload_status')
    .eq('attempt_id', attempt.id)
    .eq('participant_id', participantId)
    .maybeSingle()
  return imageError || !image ? null : image
}

/** Reserve the caller's already-created opaque path and issue one signed token. */
export async function POST(request: Request, context: RouteContext) {
  const { code } = await context.params
  const parsedRequest = await readJson(request)
  if (parsedRequest.error) return parsedRequest.error
  const base = parseBaseBody(parsedRequest.body)
  const description = parsedRequest.body as { size?: unknown; mimeType?: unknown }
  if (
    !base ||
    description.mimeType !== 'image/jpeg' ||
    typeof description.size !== 'number' ||
    !Number.isInteger(description.size) ||
    description.size <= 0 ||
    description.size > MAX_SHARED_PHOTO_BYTES
  ) {
    return jsonNoStore({ error: 'Invalid image upload' }, { status: 400 })
  }

  const authorization = await authorizeCaptureRequest(code)
  if (!authorization) {
    return jsonNoStore({ error: 'Room access is unavailable' }, { status: 401 })
  }
  const active = await getActiveWebRtcMember(
    authorization.access,
    base.clientId,
    base.generation
  )
  if (!active) {
    return jsonNoStore(
      { error: 'This tab no longer owns the camera session', code: 'lease_lost' },
      { status: 409 }
    )
  }

  const image = await findOwnedImage(
    active.sessionId,
    active.participantId,
    base.attemptId
  )
  if (!image) {
    return jsonNoStore({ error: 'Capture image is unavailable' }, { status: 404 })
  }
  if (image.upload_status === 'verified') {
    return jsonNoStore({ status: 'verified' })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(SHARED_PHOTO_BUCKET)
    .createSignedUploadUrl(image.storage_path, { upsert: false })
  if (error || !data?.token) {
    console.error('[Synchronized Capture] Signed upload creation failed:', error)
    return jsonNoStore({ error: 'Photo upload could not start' }, { status: 503 })
  }

  await supabase
    .from('capture_images')
    .update({ upload_status: 'uploading' })
    .eq('id', image.id)
    .in('upload_status', ['reserved', 'failed'])

  return jsonNoStore({
    status: 'upload',
    upload: { path: image.storage_path, token: data.token },
  })
}

/** Verify actual private object bytes and atomically advance the paired attempt. */
export async function PATCH(request: Request, context: RouteContext) {
  const { code } = await context.params
  const parsedRequest = await readJson(request)
  if (parsedRequest.error) return parsedRequest.error
  const base = parseBaseBody(parsedRequest.body)
  const details = parsedRequest.body as {
    capturedAt?: unknown
    timing?: unknown
  }
  const capturedAt =
    typeof details.capturedAt === 'string' ? Date.parse(details.capturedAt) : Number.NaN
  if (!base || !Number.isFinite(capturedAt)) {
    return jsonNoStore({ error: 'Invalid image verification' }, { status: 400 })
  }

  const authorization = await authorizeCaptureRequest(code)
  if (!authorization) {
    return jsonNoStore({ error: 'Room access is unavailable' }, { status: 401 })
  }
  const active = await getActiveWebRtcMember(
    authorization.access,
    base.clientId,
    base.generation
  )
  if (!active) {
    return jsonNoStore(
      { error: 'This tab no longer owns the camera session', code: 'lease_lost' },
      { status: 409 }
    )
  }

  const image = await findOwnedImage(
    active.sessionId,
    active.participantId,
    base.attemptId
  )
  if (!image) {
    return jsonNoStore({ error: 'Capture image is unavailable' }, { status: 404 })
  }

  const supabase = createAdminClient()
  if (image.upload_status !== 'verified') {
    const { data: blob, error: downloadError } = await supabase.storage
      .from(SHARED_PHOTO_BUCKET)
      .download(image.storage_path)
    if (downloadError || !blob) {
      return jsonNoStore(
        { error: 'The uploaded photo could not be verified. Retry the upload.' },
        { status: 409 }
      )
    }

    const bytes = new Uint8Array(await blob.arrayBuffer())
    const dimensions = readJpegDimensions(bytes)
    if (
      !dimensions ||
      bytes.byteLength <= 0 ||
      bytes.byteLength > MAX_SHARED_PHOTO_BYTES
    ) {
      await supabase.storage.from(SHARED_PHOTO_BUCKET).remove([image.storage_path])
      await supabase
        .from('capture_images')
        .update({ upload_status: 'failed' })
        .eq('id', image.id)
      return jsonNoStore({ error: 'The uploaded file is not a valid JPEG photo.' }, { status: 400 })
    }

    const timing =
      details.timing && typeof details.timing === 'object'
        ? details.timing as Record<string, unknown>
        : {}
    const boundedNumber = (value: unknown, limit: number) =>
      typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
        ? Math.round(value * 100) / 100
        : null
    const metadata = {
      scheduledDeltaMs: boundedNumber(timing.scheduledDeltaMs, 300_000),
      monotonicLatenessMs: boundedNumber(timing.monotonicLatenessMs, 300_000),
      clockOffsetMs: boundedNumber(timing.clockOffsetMs, 86_400_000),
      clockRoundTripMs: boundedNumber(timing.clockRoundTripMs, 60_000),
      recovery: timing.recovery === true,
      verifiedFromStoredBytes: true,
    }

    const { error: completeError } = await supabase.rpc(
      'complete_synchronized_capture_upload',
      {
        p_room_code: code,
        p_capability_hash: hashCapability(authorization.capability),
        p_client_id: base.clientId,
        p_generation: base.generation,
        p_attempt_opaque_id: base.attemptId,
        p_width_px: dimensions.width,
        p_height_px: dimensions.height,
        p_file_size_bytes: bytes.byteLength,
        p_captured_at: new Date(capturedAt).toISOString(),
        p_capture_metadata: metadata,
      }
    )
    if (completeError) {
      console.error('[Synchronized Capture] Completion failed:', completeError)
      return jsonNoStore(
        { error: 'Photo stored, but verification could not finish. Retry verification.' },
        { status: 503 }
      )
    }
  }

  const capture = await loadSynchronizedCaptureState({
    roomCode: code,
    capability: authorization.capability,
    access: authorization.access,
  })
  if (!capture) {
    return jsonNoStore({ error: 'Capture state could not be loaded' }, { status: 503 })
  }

  try {
    await broadcastCaptureState(code, capture)
  } catch (broadcastError) {
    console.error('[Synchronized Capture] Invalidation broadcast failed:', broadcastError)
  }

  return jsonNoStore({ status: 'verified', capture })
}
