import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateRoomCode } from '@/lib/room-code'
import { generateCapability, hashCapability } from '@/lib/capability'

/**
 * POST /api/rooms - Create a new room
 *
 * Creates a temporary anonymous two-person room with capability-based authorization.
 *
 * Flow:
 * 1. Generate unique room code (WORD-## format)
 * 2. Generate cryptographically secure capability token (256-bit)
 * 3. Hash capability with SHA-256
 * 4. Call create_room() PostgreSQL function (atomic operation)
 * 5. Set capability as HttpOnly cookie
 * 6. Return room code for navigation
 *
 * Security:
 * - Capability generation is server-side only (never client-provided)
 * - Only capability hash is stored in database (not plaintext)
 * - Raw capability sent only via HttpOnly, Secure, SameSite=Lax cookie
 * - Room code collision handled by database UNIQUE constraint
 * - No internal errors exposed to client
 *
 * @returns { roomCode: string } on success
 * @returns { error: string } on failure (generic message, no internal details)
 */
export async function POST() {
  try {
    // Maximum retry attempts for room code collision
    const MAX_RETRIES = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Generate room code (e.g., "MOON-47")
        const roomCode = generateRoomCode()

        // Generate cryptographically secure capability token (256-bit entropy)
        // This is the authorization credential, NOT the room code
        const capability = generateCapability()

        // Hash capability with SHA-256 before storing
        // Database stores only the hash (defense-in-depth against DB compromise)
        const capabilityHash = hashCapability(capability)

        // Call server-controlled PostgreSQL function to atomically create:
        // 1. Room record with generated code
        // 2. First participant record with hashed capability
        // Uses admin client (service role) which bypasses RLS
        const supabase = createAdminClient()

        const { data, error } = await supabase.rpc('create_room', {
          p_room_code: roomCode,
          p_capability_hash: capabilityHash,
        })

        if (error) {
          // Check if error is due to unique constraint violation (room code collision)
          // PostgreSQL error code 23505 = unique_violation
          if (error.code === '23505' || error.message?.includes('unique')) {
            // Retry with new room code
            lastError = error
            continue
          }

          // Other database errors - log server-side, return generic error to client
          console.error('[Create Room] Database error:', error)
          return NextResponse.json(
            { error: 'Failed to create room' },
            { status: 500 }
          )
        }

        if (!data || data.length === 0) {
          console.error('[Create Room] No data returned from create_room()')
          return NextResponse.json(
            { error: 'Failed to create room' },
            { status: 500 }
          )
        }

        // Room created successfully
        // Set capability as HttpOnly cookie (never expose in response JSON)
        const cookieStore = await cookies()
        cookieStore.set('session_capability', capability, {
          httpOnly: true, // JavaScript cannot access (XSS protection)
          secure: process.env.NODE_ENV === 'production', // HTTPS only in production
          sameSite: 'lax', // CSRF protection, allows navigation from external sites
          path: '/', // Available across entire site
          maxAge: 30 * 60, // 30 minutes (matches room expiration)
        })

        // Return only the room code (client uses this for navigation)
        // Never return: capability, capability_hash, room UUID, participant ID
        return NextResponse.json(
          { roomCode },
          { status: 201 }
        )
      } catch (err) {
        lastError = err as Error
        // Continue to next retry
      }
    }

    // All retries exhausted
    console.error('[Create Room] Max retries exceeded:', lastError)
    return NextResponse.json(
      { error: 'Failed to create room' },
      { status: 500 }
    )
  } catch (error) {
    // Unexpected error - log server-side, return generic error to client
    console.error('[Create Room] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Failed to create room' },
      { status: 500 }
    )
  }
}
