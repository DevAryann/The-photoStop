import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateCapability, hashCapability } from '@/lib/capability'
import { isValidRoomCodeFormat } from '@/lib/room-code'

/**
 * POST /api/rooms/join - Join an existing room
 *
 * Allows a second participant to join a room using the room code.
 *
 * Flow:
 * 1. Validate room code format (client provides discovery information only)
 * 2. Generate NEW cryptographically secure capability token (256-bit)
 * 3. Hash capability with SHA-256
 * 4. Call join_room() PostgreSQL function (atomic validation + insertion)
 * 5. ONLY after successful join, set NEW capability as HttpOnly cookie
 * 6. Return success (client navigates to room)
 *
 * Security:
 * - Room code is discovery information, NOT authorization
 * - Capability generation is server-side only (never client-provided)
 * - Server validates room availability (not full, not expired)
 * - Only capability hash stored in database (not plaintext)
 * - Raw capability sent only via HttpOnly, Secure, SameSite=Lax cookie
 * - Generic error messages (do not expose internal state)
 * - Replaces existing session_capability cookie after successful join
 *
 * @returns { success: true } on successful join
 * @returns { error: string } on failure (generic message)
 */
export async function POST(request: Request) {
  try {
    // Parse request body
    const body = await request.json()
    const { roomCode } = body

    // Validate room code presence
    if (!roomCode || typeof roomCode !== 'string') {
      return NextResponse.json(
        { error: 'Room code is required' },
        { status: 400 }
      )
    }

    // Validate room code format (WORD-## pattern, case-insensitive)
    // Expected format: word (variable length), hyphen, 2-digit number (10-99)
    const normalizedRoomCode = roomCode.trim().toUpperCase()

    if (!isValidRoomCodeFormat(normalizedRoomCode)) {
      return NextResponse.json(
        { error: 'Invalid room code format' },
        { status: 400 }
      )
    }

    // Generate NEW cryptographically secure capability token (256-bit entropy)
    // This is a fresh authorization credential for this participant
    const capability = generateCapability()

    // Hash capability with SHA-256 before storing
    const capabilityHash = hashCapability(capability)

    // Call server-controlled PostgreSQL function to:
    // 1. Validate room exists and is available (not full, not expired)
    // 2. Atomically insert second participant record with hashed capability
    // Uses admin client (service role) which bypasses RLS
    const supabase = createAdminClient()

    const { data, error } = await supabase.rpc('join_room', {
      p_room_code: normalizedRoomCode,
      p_capability_hash: capabilityHash,
    })

    if (error) {
      // PostgreSQL function raises 'room_not_joinable' when room is missing,
      // full, expired, or no longer waiting
      // Check for this specific exception
      if (error.message?.includes('room_not_joinable')) {
        // Log for debugging but return generic message to client
        console.error('[Join Room] Room not joinable:', normalizedRoomCode)
        return NextResponse.json(
          { error: 'Room not available' },
          { status: 404 }
        )
      }

      // Unexpected database error
      console.error('[Join Room] Unexpected database error:', error)
      return NextResponse.json(
        { error: 'Unable to join room' },
        { status: 500 }
      )
    }

    // Verify we received data from the function
    if (!data) {
      console.error('[Join Room] No data returned from join_room()')
      return NextResponse.json(
        { error: 'Unable to join room' },
        { status: 500 }
      )
    }

    // Room joined successfully
    // Set NEW capability as HttpOnly cookie (replaces any existing capability)
    // Never expose capability in response JSON
    const cookieStore = await cookies()
    cookieStore.set('session_capability', capability, {
      httpOnly: true, // JavaScript cannot access (XSS protection)
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax', // CSRF protection, allows navigation from external sites
      path: '/', // Available across entire site
      maxAge: 30 * 60, // 30 minutes (matches room expiration)
    })

    // Return success
    // Client will navigate to /room/[code]
    return NextResponse.json(
      { success: true, roomCode: normalizedRoomCode },
      { status: 200 }
    )
  } catch (error) {
    // Unexpected error - log server-side, return generic error to client
    console.error('[Join Room] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Unable to join room' },
      { status: 500 }
    )
  }
}
