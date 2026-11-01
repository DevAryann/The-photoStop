import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { hashCapability, isValidCapabilityFormat } from '@/lib/capability'
import {
  isPhotoStripRenderConfig,
  isRoomFinalization,
  type RoomFinalization,
} from '@/lib/photo-strip-finalization'
import { isValidRoomCodeFormat } from '@/lib/room-code'
import { isPhotoSetId } from '@/lib/shared-photos'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ code: string }>
}

const noStoreHeaders = { 'Cache-Control': 'no-store' }

function jsonNoStore(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { ...init, headers: noStoreHeaders })
}

/** Atomically host-authorize and pin one ready shared set as the final strip. */
export async function POST(request: Request, context: RouteContext) {
  const { code } = await context.params
  const cookieStore = await cookies()
  const capability = cookieStore.get('session_capability')?.value

  if (
    !isValidRoomCodeFormat(code) ||
    !capability ||
    !isValidCapabilityFormat(capability)
  ) {
    return jsonNoStore({ error: 'Room access is unavailable' }, { status: 401 })
  }

  let body: { photoSetId?: unknown; renderConfig?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonNoStore({ error: 'Invalid finalization request' }, { status: 400 })
  }

  if (!isPhotoSetId(body.photoSetId) || !isPhotoStripRenderConfig(body.renderConfig)) {
    return jsonNoStore(
      { error: 'Choose a valid shared photo strip before finalizing.' },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('finalize_photo_strip', {
    p_room_code: code,
    p_capability_hash: hashCapability(capability),
    p_photo_set_id: body.photoSetId,
    p_render_config: body.renderConfig,
  })

  if (error) {
    if (error.message?.includes('host_required')) {
      return jsonNoStore(
        { error: 'Only the room host can finalize the photo strip.' },
        { status: 403 }
      )
    }
    if (error.message?.includes('photo_set_not_ready')) {
      return jsonNoStore(
        { error: 'This shared photo set is not ready. Wait for sharing to finish and try again.' },
        { status: 409 }
      )
    }
    if (error.message?.includes('photo_set_not_current')) {
      return jsonNoStore(
        { error: 'A newer shared photo set is available. Open it before finalizing.' },
        { status: 409 }
      )
    }
    if (error.message?.includes('invalid_render_config')) {
      return jsonNoStore(
        { error: 'These strip settings cannot be finalized. Refresh the room and try again.' },
        { status: 400 }
      )
    }
    if (
      error.message?.includes('room_access_denied') ||
      error.message?.includes('room_not_finalizable')
    ) {
      return jsonNoStore(
        { error: 'This room can no longer be finalized.' },
        { status: 409 }
      )
    }

    console.error('[Finalize Strip] Database operation failed:', error)
    return jsonNoStore(
      { error: 'The strip could not be finalized. Please try again.' },
      { status: 503 }
    )
  }

  const result = data?.[0]
  const finalization: RoomFinalization | null = result
    ? {
        photoSetId: result.finalized_photo_set_id,
        finalizedAt: result.room_finalized_at,
        renderConfig: result.render_config,
      }
    : null

  if (!isRoomFinalization(finalization)) {
    console.error('[Finalize Strip] Invalid response from finalize_photo_strip()')
    return jsonNoStore(
      { error: 'The strip was finalized, but its result could not be loaded. Refresh the room.' },
      { status: 503 }
    )
  }

  // Realtime is a fast invalidation signal only. Recipients fetch capability-
  // protected room and photo state before displaying the final result.
  try {
    const channel = supabase.channel(`room:${code}`)
    await channel.send({
      type: 'broadcast',
      event: 'strip_finalized',
      payload: { photoSetId: finalization.photoSetId },
    })
    await supabase.removeChannel(channel)
  } catch (broadcastError) {
    console.error('[Finalize Strip] Broadcast failed:', broadcastError)
  }

  return jsonNoStore({ finalization })
}
