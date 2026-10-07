import Link from 'next/link'
import { cookies } from 'next/headers'
import { validateRoomAccess } from '@/lib/room-validation'
import { RoomClient } from '@/components/room/room-client'

/**
 * Room Page - /room/[code]
 *
 * Displays the room session view with state validation.
 *
 * Security:
 * - Validates room exists and has not expired
 * - Validates user's session capability belongs to a participant in this room
 * - Never exposes capability hash, room UUID, or participant IDs
 * - Shows generic "Room not available" for all unauthorized cases
 *
 * Room States:
 * - waiting: Room created, waiting for 2nd participant (participant_count = 1)
 * - active: Both participants joined, session in progress (participant_count = 2)
 *
 * Future phases will add:
 * - Camera setup and photo capture
 * - Photo editor with filters/stickers/layouts
 * - Real-time collaboration (V1.5)
 * - Download functionality
 */

interface RoomPageProps {
  params: Promise<{
    code: string
  }>
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { code } = await params

  // Read session capability from HttpOnly cookie
  const cookieStore = await cookies()
  const capability = cookieStore.get('session_capability')?.value

  // Validate room access server-side
  // Returns { authorized: true, roomState } or { authorized: false }
  const accessResult = capability
    ? await validateRoomAccess(code, capability)
    : { authorized: false }

  // Show generic "Room not available" for all unauthorized cases:
  // - Missing/invalid session capability
  // - Room doesn't exist
  // - Room expired
  // - Capability doesn't belong to this room
  // - Room state is completed/expired
  if (!accessResult.authorized) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 sm:px-12 md:px-24">
        <div className="w-full max-w-md flex flex-col items-center gap-8">
          {/* Error State */}
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--surface)] border-2 border-[var(--border)] flex items-center justify-center">
              <svg
                width="32"
                height="32"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M16 10V16M16 22H16.01"
                  stroke="var(--text-secondary)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold">Room Not Available</h1>
              <p className="text-[var(--text-secondary)]">
                This room doesn&apos;t exist or is no longer accessible
              </p>
            </div>
          </div>

          {/* Back to Home */}
          <Link
            href="/"
            className="px-6 py-3 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] text-white font-medium hover:opacity-90 transition-opacity"
          >
            Create a New Room
          </Link>
        </div>
      </main>
    )
  }

  // Access granted - render client component with real-time subscription
  // TypeScript knows roomState exists because authorized === true
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 sm:px-12 md:px-24">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        <RoomClient code={code} initialState={accessResult.roomState!} />
      </div>
    </main>
  )
}
