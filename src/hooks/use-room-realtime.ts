'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * Subscribe to real-time room state changes via Supabase Broadcast
 *
 * Uses Realtime Broadcast channels (not Postgres Changes):
 * - No database access required
 * - No RLS policies needed
 * - Server explicitly publishes state changes after join_room() succeeds
 * - Client receives only what server broadcasts
 *
 * Security:
 * - Channel name contains room code (already public/shareable)
 * - Anyone who knows the room code can subscribe to the broadcast channel
 * - Broadcast payload contains only safe state info: { state: 'active' }
 * - No capability tokens, participant IDs, or internal UUIDs exposed
 * - Room page validates capability server-side before showing content
 * - Subscribing to broadcast does not grant access to room content
 *
 * @param roomCode - Public room code (e.g., "MOON-47")
 * @param initialState - Server-validated initial state from page load
 * @returns Current room state (updates when broadcast received)
 */
export function useRoomRealtime(
  roomCode: string,
  initialState: 'waiting' | 'active'
) {
  const [roomState, setRoomState] = useState<'waiting' | 'active'>(initialState)

  useEffect(() => {
    // Only subscribe if still waiting (no need to subscribe if already active)
    if (initialState === 'active') {
      return
    }

    const supabase = createClient()

    // Subscribe to broadcast channel for this room
    // Channel name: room:<CODE> (room code is already public/shareable)
    // Note: Anyone who knows the room code can subscribe to this channel
    // This is acceptable because broadcast contains no sensitive data
    const channel: RealtimeChannel = supabase
      .channel(`room:${roomCode}`)
      .on(
        'broadcast',
        { event: 'state_change' },
        (payload: { payload: { state: string } }) => {
          const newState = payload.payload.state

          // Use functional update to avoid dependency on roomState
          // This prevents recreating the subscription when state changes
          setRoomState((currentState) => {
            // Only update if transitioning to active (waiting → active)
            if (newState === 'active' && currentState === 'waiting') {
              return 'active'
            }
            return currentState
          })
        }
      )
      .subscribe()

    // Cleanup: unsubscribe when component unmounts
    return () => {
      supabase.removeChannel(channel)
    }
  }, [roomCode, initialState])

  return roomState
}
