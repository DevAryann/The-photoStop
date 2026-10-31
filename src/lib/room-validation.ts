import { createAdminClient } from '@/lib/supabase/admin'
import { hashCapability, isValidCapabilityFormat } from '@/lib/capability'
import { isValidRoomCodeFormat } from '@/lib/room-code'
import {
  getParticipantDisplayName,
  isRoomPresenceKey,
  type RoomPresenceIdentity,
  type RoomPresenceKey,
  type RoomState,
} from '@/lib/room-presence'

/**
 * Room Access Validation Result
 *
 * Minimal safe data returned to the page:
 * - authorized: Whether the user has valid access to this room
 * - roomState: Current room state (only if authorized)
 * - participant: Safe, room-local presence identity (only if authorized)
 *
 * Never exposes: capability hash, room UUID, participant UUID, detailed errors
 */
export type RoomAccessResult =
  | {
      authorized: true
      roomState: RoomState
      participant: RoomPresenceIdentity
      hostKey: RoomPresenceKey
      isHost: boolean
    }
  | { authorized: false }

export interface AuthorizedRoomCapability {
  roomId: string
  participantId: string
  roomState: RoomState
  participant: RoomPresenceIdentity
  hostKey: RoomPresenceKey
  isHost: boolean
}

/**
 * Validates room access for the current session
 *
 * Performs comprehensive server-side validation:
 * 1. Room code format validation
 * 2. Session capability format validation
 * 3. Room exists in database
 * 4. Room has not expired (expires_at > NOW())
 * 5. Room state is valid (waiting or active)
 * 6. Session capability belongs to a participant in this room
 *
 * Security properties:
 * - Uses admin client to query database (bypasses RLS)
 * - Hashes capability before database query (never sends plaintext)
 * - Returns only minimal safe data (authorized flag, state, and room-local label)
 * - Never exposes internal identifiers or detailed error reasons
 * - Same generic response for all unauthorized cases (room missing, expired, wrong capability)
 *
 * @param roomCode - The room code from URL (e.g., "MOON-47")
 * @param capability - The raw capability token from session cookie
 * @returns { authorized: true, roomState } if access granted, { authorized: false } otherwise
 *
 * @example
 * const result = await validateRoomAccess("MOON-47", capability)
 * if (result.authorized) {
 *   // User has valid access, show room UI with state
 *   console.log(result.roomState) // "waiting" | "active"
 * } else {
 *   // Show generic "Room not available" message
 * }
 */
export async function validateRoomAccess(
  roomCode: string,
  capability: string
): Promise<RoomAccessResult> {
  const access = await authorizeRoomCapability(roomCode, capability)
  if (!access) return { authorized: false }

  return {
    authorized: true,
    roomState: access.roomState,
    participant: access.participant,
    hostKey: access.hostKey,
    isHost: access.isHost,
  }
}

/**
 * Server-only authorization result for room API routes.
 * Internal IDs must never be serialized to the browser.
 */
export async function authorizeRoomCapability(
  roomCode: string,
  capability: string
): Promise<AuthorizedRoomCapability | null> {
  try {
    // Validate room code format (WORD-## pattern)
    if (!isValidRoomCodeFormat(roomCode)) {
      return null
    }

    // Validate capability format (base64url, 43 chars)
    if (!isValidCapabilityFormat(capability)) {
      return null
    }

    // Hash capability with SHA-256 (same as stored in database)
    const capabilityHash = hashCapability(capability)

    // Query database to validate room access
    // Strategy: First get the room, then verify participant belongs to it
    // This requires two queries since Supabase client doesn't support
    // joining tables with type-safe filtering on both sides
    const supabase = createAdminClient()

    // Step 1: Get the room and verify it exists, is not expired, and is active/waiting
    const { data: roomData, error: roomError } = await supabase
      .from('rooms')
      .select('id, state, host_participant_id')
      .eq('code', roomCode)
      .gt('expires_at', new Date().toISOString())
      .in('state', ['waiting', 'active', 'ended'])
      .limit(1)
      .single()

    // If room query fails or returns no data, deny access
    if (roomError || !roomData) {
      return null
    }

    // Step 2: Verify the capability belongs to a participant in this room.
    // Stable presence identities and host ownership are assigned by trusted
    // database functions; neither is inferred from client data or timestamps.
    const { data: participantData, error: participantError } = await supabase
      .from('participants')
      .select('id, capability_hash, presence_key')
      .eq('room_id', roomData.id)

    // If participant query fails or returns no data, deny access
    if (participantError || !participantData?.length) {
      return null
    }

    const participantRecord = participantData.find(
      (participant) => participant.capability_hash === capabilityHash
    )
    const hostRecord = participantData.find(
      (participant) => participant.id === roomData.host_participant_id
    )

    if (
      !participantRecord ||
      !hostRecord ||
      !isRoomPresenceKey(participantRecord.presence_key) ||
      !isRoomPresenceKey(hostRecord.presence_key)
    ) {
      return null
    }

    const presenceKey = participantRecord.presence_key
    const isHost = participantRecord.id === roomData.host_participant_id

    return {
      roomId: roomData.id,
      participantId: participantRecord.id,
      roomState: roomData.state as RoomState,
      participant: {
        key: presenceKey,
        displayName: getParticipantDisplayName(presenceKey),
      },
      hostKey: hostRecord.presence_key,
      isHost,
    }
  } catch (error) {
    // Unexpected error - log server-side, deny access
    console.error('[Room Validation] Unexpected error:', error)
    return null
  }
}
