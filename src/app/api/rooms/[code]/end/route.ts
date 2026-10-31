import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { hashCapability, isValidCapabilityFormat } from '@/lib/capability'
import { isValidRoomCodeFormat } from '@/lib/room-code'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ code: string }>
}

const noStoreHeaders = { 'Cache-Control': 'no-store' }

function jsonNoStore(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreHeaders,
  })
}

/** End a room through the host-authorized, idempotent database operation. */
export async function POST(_request: Request, context: RouteContext) {
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

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('end_room', {
    p_room_code: code,
    p_capability_hash: hashCapability(capability),
  })

  if (error) {
    if (error.message?.includes('host_required')) {
      return jsonNoStore(
        { error: 'Only the host can end this room.' },
        { status: 403 }
      )
    }

    if (
      error.message?.includes('room_access_denied') ||
      error.message?.includes('room_not_endable')
    ) {
      return jsonNoStore(
        { error: 'This room is no longer available.' },
        { status: 409 }
      )
    }

    console.error('[End Room] Database operation failed:', error)
    return jsonNoStore(
      { error: 'The room could not be ended. Please try again.' },
      { status: 503 }
    )
  }

  if (!data?.length || data[0]?.room_state !== 'ended') {
    console.error('[End Room] Invalid response from end_room()')
    return jsonNoStore(
      { error: 'The room could not be ended. Please try again.' },
      { status: 503 }
    )
  }

  // Realtime is a fast invalidation signal only. Every recipient verifies the
  // authoritative database state through GET /api/rooms/[code].
  try {
    const channel = supabase.channel(`room:${code}`)
    await channel.send({
      type: 'broadcast',
      event: 'state_change',
      payload: { state: 'ended' },
    })
    await supabase.removeChannel(channel)
  } catch (broadcastError) {
    // Ending has already committed. Polling, focus, and reconnect checks recover
    // a missed signal, so broadcast failure must not make the operation fail.
    console.error('[End Room] Broadcast failed:', broadcastError)
  }

  return jsonNoStore({
    state: 'ended',
    endedAt: data[0].room_ended_at,
  })
}
