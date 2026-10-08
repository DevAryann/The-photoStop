'use client'

import Link from 'next/link'
import { useRoomRealtime } from '@/hooks/use-room-realtime'
import { CameraView } from '@/components/camera/camera-view'

interface RoomClientProps {
  code: string
  initialState: 'waiting' | 'active'
}

/**
 * Client-side room UI with real-time state updates
 *
 * Subscribes to Realtime broadcast channel to detect when second participant joins.
 * Server publishes state change after successful join_room() execution.
 *
 * V1 Camera Integration:
 * - Shows camera UI only when room is active
 * - Camera permission requested only after explicit user action
 * - Maintains existing room authorization model
 *
 * Security:
 * - Capability validation happens server-side (parent Server Component)
 * - This component only handles UI updates based on broadcast events
 * - Broadcast channel is public (anyone with room code can subscribe)
 * - Broadcast contains no sensitive data (only state: 'active')
 * - Room content access still requires valid capability cookie
 */
export function RoomClient({ code, initialState }: RoomClientProps) {
  // Subscribe to real-time state updates via broadcast channel
  const roomState = useRoomRealtime(code, initialState)
  const isWaiting = roomState === 'waiting'
  const isActive = roomState === 'active'

  return (
    <>
      {/* Room Status */}
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] flex items-center justify-center">
          {isWaiting ? (
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="animate-spin"
            >
              <path
                d="M16 4V8M16 24V28M8 16H4M28 16H24M22.364 22.364L19.536 19.536M22.364 9.636L19.536 12.464M9.636 22.364L12.464 19.536M9.636 9.636L12.464 12.464"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M9 16L14 21L23 11"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">
            {isWaiting ? 'Waiting for Participant' : 'Room Active'}
          </h1>
          <p className="text-[var(--text-secondary)]">
            {isWaiting
              ? 'Share the room code to invite someone'
              : 'Both participants are here'}
          </p>
        </div>
      </div>

      {/* Room Code Display */}
      <div className="w-full flex flex-col items-center gap-3 p-6 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
        <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)} font-medium">
          Room Code
        </span>
        <div className="text-4xl font-bold tracking-wider font-mono">
          {code}
        </div>
        <p className="text-sm text-[var(--text-secondary)] text-center">
          {isWaiting
            ? 'Share this code with a friend to start'
            : 'Ready to capture photos together'}
        </p>
      </div>

      {/* Camera View - Only shown when room is active */}
      {isActive && (
        <div className="w-full">
          <CameraView />
        </div>
      )}

      {/* Waiting State Indicator */}
      {isWaiting && (
        <div className="w-full p-4 rounded-lg bg-[var(--surface)] border border-[var(--border-active)]">
          <p className="text-sm text-[var(--text-secondary)] text-center">
            <span className="font-semibold text-[var(--text-primary)]">
              Waiting...
            </span>{' '}
            The session will start when a second participant joins
          </p>
        </div>
      )}

      {/* Back to Home */}
      <Link
        href="/"
        className="text-sm text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors underline underline-offset-4"
      >
        ← Back to home
      </Link>
    </>
  )
}
