'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  getParticipantDisplayName,
  isRoomActivity,
  isRoomPresenceKey,
  type RoomActivity,
  type RoomPresenceIdentity,
  type RoomPresenceKey,
  type RoomPresenceParticipant,
  type RoomState,
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
  activity?: unknown
  activityUpdatedAt?: unknown
}

const MAX_ACTIVITY_CLOCK_SKEW_MS = 5 * 60 * 1000

function getActivityUpdatedAt(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > Date.now() + MAX_ACTIVITY_CLOCK_SKEW_MS
  ) {
    return 0
  }

  return value
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
  initialState: RoomState,
  participant: RoomPresenceIdentity,
  hostKey: RoomPresenceKey
) {
  const [roomState, setRoomState] = useState<RoomState>(initialState)
  const [participants, setParticipants] = useState<RoomPresenceParticipant[]>([])
  const [presenceStatus, setPresenceStatus] =
    useState<RoomPresenceStatus>('connecting')
  const [retryCount, setRetryCount] = useState(0)
  const [photoSetSignal, setPhotoSetSignal] = useState<string | null>(null)
  const [subscriptionVersion, setSubscriptionVersion] = useState(0)
  const activityRef = useRef<RoomActivity>('idle')
  const requestActivityTrackRef = useRef<(() => void) | null>(null)
  const stateRefreshAbortRef = useRef<AbortController | null>(null)

  const refreshRoomState = useCallback(async () => {
    stateRefreshAbortRef.current?.abort()
    const controller = new AbortController()
    stateRefreshAbortRef.current = controller

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) return

      const body = await response.json() as { state?: unknown }
      if (
        body.state === 'waiting' ||
        body.state === 'active' ||
        body.state === 'ended'
      ) {
        setRoomState(body.state)
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('[Room State] Authoritative refresh failed:', error)
      }
    }
  }, [roomCode])

  const markRoomEnded = useCallback(() => {
    setRoomState('ended')
  }, [])

  const retryPresence = useCallback(() => {
    setParticipants([])
    setPresenceStatus('connecting')
    setRetryCount((current) => current + 1)
  }, [])

  const setActivity = useCallback((activity: RoomActivity) => {
    if (activityRef.current === activity) return

    activityRef.current = activity
    setParticipants((current) =>
      current.map((onlineParticipant) =>
        onlineParticipant.isCurrentUser
          ? { ...onlineParticipant, activity }
          : onlineParticipant
      )
    )
    requestActivityTrackRef.current?.()
  }, [])

  useEffect(() => {
    let isCurrentSubscription = true
    let canTrack = false
    let isTracking = false
    let lastTrackedActivity: RoomActivity | null = null
    const supabase = createClient()

    const syncParticipants = (channel: RealtimeChannel) => {
      const state = channel.presenceState<PresencePayload>()
      const nextParticipants: RoomPresenceParticipant[] = []

      for (const [key, presences] of Object.entries(state)) {
        if (!isRoomPresenceKey(key)) {
          continue
        }

        const displayName = getParticipantDisplayName(key)
        const validPresences = presences.filter(
          (presence) =>
            presence.participantKey === key &&
            presence.displayName === displayName
        )

        if (validPresences.length > 0) {
          const latestPresence = validPresences.reduce((latest, presence) =>
            getActivityUpdatedAt(presence.activityUpdatedAt) >=
            getActivityUpdatedAt(latest.activityUpdatedAt)
              ? presence
              : latest
          )

          nextParticipants.push({
            key,
            displayName,
            isCurrentUser: key === participant.key,
            isHost: key === hostKey,
            activity: isRoomActivity(latestPresence.activity)
              ? latestPresence.activity
              : 'idle',
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

          if (
            isCurrentSubscription &&
            (newState === 'active' || newState === 'ended')
          ) {
            // Public Realtime messages are only invalidation signals. Verify the
            // transition against the capability-protected server state.
            void refreshRoomState()
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
          canTrack = true
          lastTrackedActivity = null
          requestActivityTrackRef.current?.()
          void refreshRoomState()
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          canTrack = false
          lastTrackedActivity = null
          setPresenceStatus('reconnecting')
          return
        }

        if (status === 'CLOSED') {
          canTrack = false
          lastTrackedActivity = null
          setPresenceStatus('error')
        }
      })

    const trackCurrentActivity = () => {
      if (!isCurrentSubscription || !canTrack || isTracking) return

      const activity = activityRef.current
      if (activity === lastTrackedActivity) return

      isTracking = true
      void channel
        .track({
          participantKey: participant.key,
          displayName: participant.displayName,
          activity,
          activityUpdatedAt: Date.now(),
        })
        .then((trackStatus) => {
          if (!isCurrentSubscription) return

          if (trackStatus === 'ok') {
            lastTrackedActivity = activity
            setPresenceStatus('connected')
          } else {
            canTrack = false
            lastTrackedActivity = null
            setPresenceStatus('error')
          }
        })
        .catch(() => {
          if (isCurrentSubscription) {
            canTrack = false
            lastTrackedActivity = null
            setPresenceStatus('error')
          }
        })
        .finally(() => {
          if (!isCurrentSubscription) return

          isTracking = false
          if (activityRef.current !== lastTrackedActivity) {
            trackCurrentActivity()
          }
        })
    }

    requestActivityTrackRef.current = trackCurrentActivity

    // The channel may subscribe synchronously in test clients, before the
    // tracking callback above is installed.
    trackCurrentActivity()

    return () => {
      isCurrentSubscription = false
      canTrack = false
      if (requestActivityTrackRef.current === trackCurrentActivity) {
        requestActivityTrackRef.current = null
      }
      void supabase.removeChannel(channel)
    }
  }, [hostKey, participant.displayName, participant.key, refreshRoomState, retryCount, roomCode])

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refreshRoomState()
    }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRoomState()
    }, 15_000)

    window.addEventListener('focus', refreshIfVisible)
    window.addEventListener('online', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshIfVisible)
      window.removeEventListener('online', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      stateRefreshAbortRef.current?.abort()
    }
  }, [refreshRoomState])

  return {
    roomState,
    participants,
    presenceStatus,
    retryPresence,
    setActivity,
    photoSetSignal,
    subscriptionVersion,
    markRoomEnded,
  }
}
