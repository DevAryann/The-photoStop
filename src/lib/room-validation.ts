import { createAdminClient } from '@/lib/supabase/admin'
import { hashCapability, isValidCapabilityFormat } from '@/lib/capability'
import { isValidRoomCodeFormat } from '@/lib/room-code'

/**
 * Room Access Validation Result
 *
 * Minimal safe data returned to the page:
 * - authorized: Whether the user has valid access to this room
 * - roomState: Current room state (only if authorized)
 *
 * Never exposes: capability hash, room UUID, participant ID, detailed errors
 */
export interface RoomAccessResult {
  authorized: boolean
  roomState?: 'waiting' | 'active'
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
 * - Returns only minimal safe data (authorized flag + state)
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
  try {
    // Validate room code format (WORD-## pattern)
    if (!isValidRoomCodeFormat(roomCode)) {
      return { authorized: false }
    }

    // Validate capability format (base64url, 43 chars)
    if (!isValidCapabilityFormat(capability)) {
      return { authorized: false }
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
      .select('id, state, participant_count')
      .eq('code', roomCode)
      .gt('expires_at', new Date().toISOString())
      .in('state', ['waiting', 'active'])
      .limit(1)
      .single()

    // If room query fails or returns no data, deny access
    if (roomError || !roomData) {
      return { authorized: false }
    }

    // Step 2: Verify the capability belongs to a participant in this specific room
    const { data: participantData, error: participantError } = await supabase
      .from('participants')
      .select('id')
      .eq('room_id', roomData.id)
      .eq('capability_hash', capabilityHash)
      .limit(1)
      .single()

    // If participant query fails or returns no data, deny access
    if (participantError || !participantData) {
      return { authorized: false }
    }

    // Access granted - return minimal safe data
    return {
      authorized: true,
      roomState: roomData.state as 'waiting' | 'active',
    }
  } catch (error) {
    // Unexpected error - log server-side, deny access
    console.error('[Room Validation] Unexpected error:', error)
    return { authorized: false }
  }
}
