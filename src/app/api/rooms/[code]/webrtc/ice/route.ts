import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { authorizeRoomCapability } from '@/lib/room-validation'
import { createProtectedIceConfiguration } from '@/lib/webrtc-ice'

interface RouteContext {
  params: Promise<{ code: string }>
}

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

function jsonNoStore(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { ...init, headers: noStoreHeaders })
}

/** Return short-lived, room-authorized STUN/TURN configuration. */
export async function GET(_request: Request, context: RouteContext) {
  const { code } = await context.params
  const cookieStore = await cookies()
  const capability = cookieStore.get('session_capability')?.value
  const access = capability
    ? await authorizeRoomCapability(code, capability)
    : null

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

  try {
    return jsonNoStore(createProtectedIceConfiguration())
  } catch (error) {
    console.error('[WebRTC ICE] Configuration unavailable:', error)
    return jsonNoStore(
      {
        error:
          'Camera connection service is not configured. Ask the deployer to configure TURN, or enable the documented local STUN-only fallback.',
        code: 'ice_configuration_unavailable',
      },
      { status: 503 }
    )
  }
}
