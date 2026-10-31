import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { authorizeRoomCapability } from '@/lib/room-validation'

interface RouteContext {
  params: Promise<{ code: string }>
}

const noStoreHeaders = { 'Cache-Control': 'no-store' }

/** Authoritative room state used to recover from missed Realtime messages. */
export async function GET(_request: Request, context: RouteContext) {
  const { code } = await context.params
  const cookieStore = await cookies()
  const capability = cookieStore.get('session_capability')?.value
  const access = capability
    ? await authorizeRoomCapability(code, capability)
    : null

  if (!access) {
    return NextResponse.json(
      { error: 'Room access is unavailable' },
      { status: 401, headers: noStoreHeaders }
    )
  }

  return NextResponse.json(
    {
      state: access.roomState,
      isHost: access.isHost,
    },
    { headers: noStoreHeaders }
  )
}
