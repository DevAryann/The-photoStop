'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  getParticipantDisplayName,
  isRoomPresenceKey,
  type RoomPresenceIdentity,
  type RoomPresenceParticipant,
} from '@/lib/room-presence'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { isPhotoSetId } from '@/lib/shared-photos'

export type RoomPresenceStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

interface PresencePayload {
  participantKey: string
  displayName: string
}

/**
 * Subscribe to room state Broadcast and participant Presence on one channel.
 *
 * Uses Realtime Broadcast channels (not Postgres Changes):
 * - No public database access required
 * - No RLS policies needed
 * - Server explicitly publishes state changes after join_room() succeeds
 * - Presence uses only server-derived, room-local participant labels
 *
 * Security:
 * - Channel name contains room code (already public/shareable)
 * - Anyone who knows the room code can subscribe to the broadcast channel
 * - Realtime payloads contain only safe state and participant labels
 * - No capability tokens, capability hashes, room UUIDs, or participant UUIDs exposed
 * - Room page validates capability server-side before showing content
 * - Subscribing to broadcast does not grant access to room content
 *
 * @param roomCode - Public room code (e.g., "MOON-47")
 * @param initialState - Server-validated initial state from page load
 * @returns Room state, deduplicated online participants, and connection state
 */
export function useRoomRealtime(
  roomCode: string,
  initialState: 'waiting' | 'active',
  participant: RoomPresenceIdentity
) {
  const [roomState, setRoomState] = useState<'waiting' | 'active'>(initialState)
  const [participants, setParticipants] = useState<RoomPresenceParticipant[]>([])
  const [presenceStatus, setPresenceStatus] =
    useState<RoomPresenceStatus>('connecting')
  const [retryCount, setRetryCount] = useState(0)
  const [photoSetSignal, setPhotoSetSignal] = useState<string | null>(null)
  const [subscriptionVersion, setSubscriptionVersion] = useState(0)

  const retryPresence = useCallback(() => {
    setParticipants([])
    setPresenceStatus('connecting')
    setRetryCount((current) => current + 1)
  }, [])

  useEffect(() => {
    let isCurrentSubscription = true
    const supabase = createClient()

    const syncParticipants = (channel: RealtimeChannel) => {
      const state = channel.presenceState<PresencePayload>()
      const nextParticipants: RoomPresenceParticipant[] = []

      for (const [key, presences] of Object.entries(state)) {
        if (!isRoomPresenceKey(key)) {
          continue
        }

        const displayName = getParticipantDisplayName(key)
        const hasValidPresence = presences.some(
          (presence) =>
            presence.participantKey === key &&
            presence.displayName === displayName
        )

        if (hasValidPresence) {
          nextParticipants.push({
            key,
            displayName,
            isCurrentUser: key === participant.key,
          })
        }
      }

      nextParticipants.sort((a, b) => a.key.localeCompare(b.key))

      if (isCurrentSubscription) {
        setParticipants(nextParticipants)
      }
    }

    // The public topic contains only the room code and safe labels. Room page
    // access remains protected by the HttpOnly capability validated server-side.
    const channel: RealtimeChannel = supabase
      .channel(`room:${roomCode}`, {
        config: { presence: { key: participant.key } },
      })
      .on(
        'broadcast',
        { event: 'state_change' },
        (message: { payload?: { state?: unknown } }) => {
          const newState = message.payload?.state

          if (isCurrentSubscription && newState === 'active') {
            setRoomState('active')
          }
        }
      )
      .on(
        'broadcast',
        { event: 'photo_set_ready' },
        (message: { payload?: { photoSetId?: unknown } }) => {
          const photoSetId = message.payload?.photoSetId
          if (isCurrentSubscription && isPhotoSetId(photoSetId)) {
            setPhotoSetSignal(photoSetId)
          }
        }
      )
      .on('presence', { event: 'sync' }, () => syncParticipants(channel))
      .subscribe((status) => {
        if (!isCurrentSubscription) {
          return
        }

        if (status === 'SUBSCRIBED') {
          setSubscriptionVersion((current) => current + 1)
          void channel
            .track({
              participantKey: participant.key,
              displayName: participant.displayName,
            })
            .then((trackStatus) => {
              if (!isCurrentSubscription) {
                return
              }

              setPresenceStatus(trackStatus === 'ok' ? 'connected' : 'error')
            })
            .catch(() => {
              if (isCurrentSubscription) {
                setPresenceStatus('error')
              }
            })
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setPresenceStatus('reconnecting')
          return
        }

        if (status === 'CLOSED') {
          setPresenceStatus('error')
        }
      })

    return () => {
      isCurrentSubscription = false
      void supabase.removeChannel(channel)
    }
  }, [roomCode, initialState, participant.displayName, participant.key, retryCount])

  return {
    roomState,
    participants,
    presenceStatus,
    retryPresence,
    photoSetSignal,
    subscriptionVersion,
  }
}
