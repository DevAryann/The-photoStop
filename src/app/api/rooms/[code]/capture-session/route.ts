import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { hashCapability, isValidCapabilityFormat } from '@/lib/capability'
import {
  parseAuthoritativeCaptureSession,
  type AuthoritativeCaptureSession,
} from '@/lib/capture-session'
import { isValidRoomCodeFormat } from '@/lib/room-code'
import { authorizeRoomCapability } from '@/lib/room-validation'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ code: string }>
}

const noStoreHeaders = { 'Cache-Control': 'no-store' }

function jsonNoStore(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { ...init, headers: noStoreHeaders })
}

async function loadMomentRows(sessionId: string) {
  const supabase = createAdminClient()
  return supabase
    .from('capture_moments')
    .select('capture_index')
    .eq('session_id', sessionId)
    .order('capture_index', { ascending: true })
}

async function serializeCaptureSession(
  sessionId: unknown,
  source: {
    opaqueId: unknown
    phase: unknown
    revision: unknown
    createdAt: unknown
    updatedAt: unknown
  },
  participantPosition: unknown
): Promise<AuthoritativeCaptureSession | null> {
  if (typeof sessionId !== 'string') return null

  const { data: momentRows, error: momentError } = await loadMomentRows(sessionId)
  if (momentError) {
    console.error('[Capture Session] Moment lookup failed:', momentError)
    return null
  }

  return parseAuthoritativeCaptureSession(
    source,
    participantPosition,
    momentRows
  )
}

/** Fetch the current authoritative capture session without creating one. */
export async function GET(_request: Request, context: RouteContext) {
  const { code } = await context.params
  const cookieStore = await cookies()
  const capability = cookieStore.get('session_capability')?.value
  const access = capability
    ? await authorizeRoomCapability(code, capability)
    : null

  if (!access) {
    return jsonNoStore(
      { error: 'Room access is unavailable' },
      { status: 401 }
    )
  }

  const supabase = createAdminClient()
  const { data: captureSession, error: sessionError } = await supabase
    .from('room_capture_sessions')
    .select('id, opaque_id, phase, revision, created_at, updated_at')
    .eq('room_id', access.roomId)
    .eq('is_current', true)
    .maybeSingle()

  if (sessionError) {
    console.error('[Capture Session] Session lookup failed:', sessionError)
    return jsonNoStore(
      { error: 'The capture session could not be loaded' },
      { status: 503 }
    )
  }

  if (!captureSession) {
    return jsonNoStore({ session: null })
  }

  const { data: member, error: memberError } = await supabase
    .from('capture_session_members')
    .select('position')
    .eq('session_id', captureSession.id)
    .eq('participant_id', access.participantId)
    .maybeSingle()

  if (memberError || !member) {
    console.error(
      '[Capture Session] Authorized member lookup failed:',
      memberError ?? 'member missing'
    )
    return jsonNoStore(
      { error: 'The capture session could not be loaded' },
      { status: 503 }
    )
  }

  const session = await serializeCaptureSession(
    captureSession.id,
    {
      opaqueId: captureSession.opaque_id,
      phase: captureSession.phase,
      revision: captureSession.revision,
      createdAt: captureSession.created_at,
      updatedAt: captureSession.updated_at,
    },
    member.position
  )

  if (!session) {
    console.error('[Capture Session] Invalid authoritative session shape')
    return jsonNoStore(
      { error: 'The capture session could not be loaded' },
      { status: 503 }
    )
  }

  return jsonNoStore({ session })
}

/** Atomically create, or idempotently obtain, the room capture session. */
export async function POST(_request: Request, context: RouteContext) {
  const { code } = await context.params
  const cookieStore = await cookies()
  const capability = cookieStore.get('session_capability')?.value

  if (
    !isValidRoomCodeFormat(code) ||
    !capability ||
    !isValidCapabilityFormat(capability)
  ) {
    return jsonNoStore(
      { error: 'Room access is unavailable' },
      { status: 401 }
    )
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc(
    'get_or_create_room_capture_session',
    {
      p_room_code: code,
      p_capability_hash: hashCapability(capability),
    }
  )

  if (error) {
    if (error.message?.includes('room_access_denied')) {
      return jsonNoStore(
        { error: 'Room access is unavailable' },
        { status: 401 }
      )
    }

    if (error.message?.includes('room_ended')) {
      return jsonNoStore({ error: 'This room has ended' }, { status: 409 })
    }

    if (error.message?.includes('room_not_capture_ready')) {
      return jsonNoStore(
        { error: 'Both participants must join before capture can start.' },
        { status: 409 }
      )
    }

    console.error('[Capture Session] Creation failed:', error)
    return jsonNoStore(
      { error: 'The capture session could not be started' },
      { status: 503 }
    )
  }

  const result = data?.[0]
  const session = result
    ? await serializeCaptureSession(
        result.capture_session_id,
        {
          opaqueId: result.opaque_session_id,
          phase: result.capture_phase,
          revision: result.capture_revision,
          createdAt: result.capture_created_at,
          updatedAt: result.capture_updated_at,
        },
        result.participant_position
      )
    : null

  if (!session || typeof result?.was_created !== 'boolean') {
    console.error(
      '[Capture Session] Invalid response from get_or_create_room_capture_session()'
    )
    return jsonNoStore(
      { error: 'The capture session could not be started' },
      { status: 503 }
    )
  }

  return jsonNoStore(
    { session, created: result.was_created },
    { status: result.was_created ? 201 : 200 }
  )
}
