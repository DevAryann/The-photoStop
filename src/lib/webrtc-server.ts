import type { AuthorizedRoomCapability } from '@/lib/room-validation'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ActiveWebRtcMember {
  sessionId: string
  participantId: string
}

/**
 * Verify that a request belongs to the exact active client-generation lease.
 * The caller may provide lease correlation values, but room/session/member
 * ownership is always derived from the already-authorized capability.
 */
export async function getActiveWebRtcMember(
  access: AuthorizedRoomCapability,
  clientId: string,
  generation: number
): Promise<ActiveWebRtcMember | null> {
  if (access.roomState !== 'active' || access.finalization) return null

  const supabase = createAdminClient()
  const { data: captureSession, error: sessionError } = await supabase
    .from('room_capture_sessions')
    .select('id')
    .eq('room_id', access.roomId)
    .eq('is_current', true)
    .maybeSingle()

  if (sessionError || !captureSession) {
    if (sessionError) {
      console.error('[WebRTC] Capture session lookup failed:', sessionError)
    }
    return null
  }

  const { data: member, error: memberError } = await supabase
    .from('capture_session_members')
    .select(
      'participant_id, active_client_generation, active_webrtc_client_id, lease_expires_at'
    )
    .eq('session_id', captureSession.id)
    .eq('participant_id', access.participantId)
    .maybeSingle()

  if (memberError || !member) {
    if (memberError) {
      console.error('[WebRTC] Active member lookup failed:', memberError)
    }
    return null
  }

  const leaseExpiry =
    typeof member.lease_expires_at === 'string'
      ? Date.parse(member.lease_expires_at)
      : Number.NaN

  if (
    member.participant_id !== access.participantId ||
    member.active_client_generation !== generation ||
    member.active_webrtc_client_id !== clientId ||
    !Number.isFinite(leaseExpiry) ||
    leaseExpiry <= Date.now()
  ) {
    return null
  }

  return {
    sessionId: captureSession.id,
    participantId: access.participantId,
  }
}
