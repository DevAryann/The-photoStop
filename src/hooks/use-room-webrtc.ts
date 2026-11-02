'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isCaptureSessionPosition,
  type CaptureSessionPosition,
} from '@/lib/capture-session'
import {
  isPositiveSignalNumber,
  parseRoomWebRtcInboxMessage,
  type RoomWebRtcIceCandidate,
  type RoomWebRtcInboxMessage,
  type RoomWebRtcLease,
  type RoomWebRtcSignalPayload,
  type RoomWebRtcSignalType,
} from '@/lib/webrtc-signaling'

export type RoomWebRtcStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'unsupported'

export interface RoomWebRtcError {
  code:
    | 'unsupported'
    | 'configuration'
    | 'another_tab'
    | 'lease_lost'
    | 'access_lost'
    | 'network'
    | 'signaling'
    | 'peer_failed'
  message: string
}

interface UseRoomWebRtcOptions {
  roomCode: string
  roomActive: boolean
  enabled: boolean
  localStream: MediaStream | null
  signalingSignalVersion: number
  subscriptionVersion: number
  onAccessLost?: () => void
  onLeaseLost?: () => void
}

export interface UseRoomWebRtcReturn {
  status: RoomWebRtcStatus
  error: RoomWebRtcError | null
  remoteStream: MediaStream | null
  participantPosition: CaptureSessionPosition | null
  reconnect: () => void
}

interface IceConfigurationResponse {
  iceServers: RTCIceServer[]
  iceTransportPolicy: RTCIceTransportPolicy
  expiresAt: string | null
  turnConfigured: boolean
}

class RoomWebRtcRequestError extends Error {
  status: number
  code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'RoomWebRtcRequestError'
    this.status = status
    this.code = code
  }
}

const INBOX_POLL_INTERVAL_MS = 2_500
const HEARTBEAT_INTERVAL_MS = 15_000
const DISCONNECTED_RESTART_DELAY_MS = 4_000
const RESTART_FAILURE_DELAY_MS = 10_000
const ICE_BATCH_DELAY_MS = 100
const REQUEST_TIMEOUT_MS = 12_000
const MAX_BUFFERED_REMOTE_CANDIDATES = 256
const MAX_PROCESSED_MESSAGE_IDS = 1_000

function getResponseMessage(body: unknown, fallback: string) {
  return body &&
    typeof body === 'object' &&
    typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : fallback
}

function getResponseCode(body: unknown) {
  return body &&
    typeof body === 'object' &&
    typeof (body as { code?: unknown }).code === 'string'
    ? (body as { code: string }).code
    : null
}

function isIceConfiguration(value: unknown): value is IceConfigurationResponse {
  if (!value || typeof value !== 'object') return false
  const config = value as Partial<IceConfigurationResponse>
  return (
    Array.isArray(config.iceServers) &&
    (config.iceTransportPolicy === 'all' ||
      config.iceTransportPolicy === 'relay') &&
    (config.expiresAt === null || typeof config.expiresAt === 'string') &&
    typeof config.turnConfigured === 'boolean'
  )
}

function isReloadNavigation() {
  const navigation = performance.getEntriesByType(
    'navigation'
  )[0] as PerformanceNavigationTiming | undefined
  return navigation?.type === 'reload'
}

export function useRoomWebRtc({
  roomCode,
  roomActive,
  enabled,
  localStream,
  signalingSignalVersion,
  subscriptionVersion,
  onAccessLost,
  onLeaseLost,
}: UseRoomWebRtcOptions): UseRoomWebRtcReturn {
  const [status, setStatus] = useState<RoomWebRtcStatus>('idle')
  const [error, setError] = useState<RoomWebRtcError | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [participantPosition, setParticipantPosition] =
    useState<CaptureSessionPosition | null>(null)
  const [leaseEpoch, setLeaseEpoch] = useState(0)

  const mountedRef = useRef(true)
  const enabledRef = useRef(enabled)
  const roomActiveRef = useRef(roomActive)
  const localStreamRef = useRef(localStream)
  const onAccessLostRef = useRef(onAccessLost)
  const onLeaseLostRef = useRef(onLeaseLost)
  const runIdRef = useRef(0)
  const clientIdRef = useRef<string | null>(null)
  const leaseRef = useRef<RoomWebRtcLease | null>(null)
  const iceConfigurationRef = useRef<IceConfigurationResponse | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const remoteTrackCleanupRef = useRef<Array<() => void>>([])
  const fetchControllersRef = useRef(new Set<AbortController>())
  const nextSequenceRef = useRef(1)
  const signalQueueRef = useRef<Promise<void>>(Promise.resolve())
  const signalingBrokenRef = useRef(false)
  const makingOfferRef = useRef(false)
  const pendingLocalOfferIdRef = useRef<string | null>(null)
  const outgoingNegotiationIdRef = useRef<string | null>(null)
  const acceptedRemoteNegotiationIdRef = useRef<string | null>(null)
  const ignoredNegotiationIdsRef = useRef(new Set<string>())
  const highestRemoteGenerationRef = useRef(0)
  const remoteCandidateBuffersRef = useRef(
    new Map<string, Array<RoomWebRtcIceCandidate | null>>()
  )
  const localCandidateBatchesRef = useRef(
    new Map<string, Array<RoomWebRtcIceCandidate | null>>()
  )
  const candidateFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const disconnectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const restartFailureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const restartAttemptsRef = useRef(0)
  const pendingIceRestartRef = useRef(false)
  const inboxReadingRef = useRef(false)
  const inboxReadAgainRef = useRef(false)
  const processedMessageIdsRef = useRef(new Set<string>())
  const reloadTakeoverAttemptedRef = useRef(false)

  const sendSignalRef = useRef<
    (
      type: RoomWebRtcSignalType,
      payload: RoomWebRtcSignalPayload,
      negotiationId: string
    ) => Promise<void>
  >(async () => undefined)
  const readInboxRef = useRef<() => Promise<void>>(async () => undefined)
  const negotiateRef = useRef<(iceRestart: boolean) => Promise<void>>(
    async () => undefined
  )
  const requestIceRestartRef = useRef<() => void>(() => undefined)
  const startConnectionRef = useRef<(force: boolean) => Promise<void>>(
    async () => undefined
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    enabledRef.current = enabled
    roomActiveRef.current = roomActive
    localStreamRef.current = localStream
    onAccessLostRef.current = onAccessLost
    onLeaseLostRef.current = onLeaseLost
  }, [enabled, localStream, onAccessLost, onLeaseLost, roomActive])

  const signalingUrl = `/api/rooms/${encodeURIComponent(
    roomCode
  )}/webrtc/signaling`

  const setLiveStatus = useCallback((nextStatus: RoomWebRtcStatus) => {
    if (mountedRef.current) setStatus(nextStatus)
  }, [])

  const setLiveError = useCallback((nextError: RoomWebRtcError | null) => {
    if (mountedRef.current) setError(nextError)
  }, [])

  const requestJson = useCallback(
    async (url: string, init?: RequestInit): Promise<unknown> => {
      const controller = new AbortController()
      fetchControllersRef.current.add(controller)
      let timedOut = false
      const timeout = window.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, REQUEST_TIMEOUT_MS)
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          ...init,
          signal: controller.signal,
        })
        const body = await response.json().catch(() => null) as unknown
        if (!response.ok) {
          throw new RoomWebRtcRequestError(
            getResponseMessage(
              body,
              'The camera connection request could not be completed.'
            ),
            response.status,
            getResponseCode(body)
          )
        }
        return body
      } catch (caughtError) {
        if (timedOut) throw new Error('The camera connection request timed out. Check your network and retry.')
        throw caughtError
      } finally {
        window.clearTimeout(timeout)
        fetchControllersRef.current.delete(controller)
      }
    },
    []
  )

  const postAction = useCallback(
    (body: Record<string, unknown>) =>
      requestJson(signalingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    [requestJson, signalingUrl]
  )

  const clearConnectionTimers = useCallback(() => {
    if (candidateFlushTimerRef.current) {
      clearTimeout(candidateFlushTimerRef.current)
      candidateFlushTimerRef.current = null
    }
    if (disconnectedTimerRef.current) {
      clearTimeout(disconnectedTimerRef.current)
      disconnectedTimerRef.current = null
    }
    if (restartFailureTimerRef.current) {
      clearTimeout(restartFailureTimerRef.current)
      restartFailureTimerRef.current = null
    }
  }, [])

  const closePeerConnection = useCallback(() => {
    clearConnectionTimers()
    localCandidateBatchesRef.current.clear()
    remoteCandidateBuffersRef.current.clear()
    ignoredNegotiationIdsRef.current.clear()
    makingOfferRef.current = false
    pendingLocalOfferIdRef.current = null
    outgoingNegotiationIdRef.current = null
    acceptedRemoteNegotiationIdRef.current = null
    pendingIceRestartRef.current = false
    restartAttemptsRef.current = 0

    const peer = peerRef.current
    peerRef.current = null
    if (peer) {
      peer.ontrack = null
      peer.onicecandidate = null
      peer.onconnectionstatechange = null
      peer.oniceconnectionstatechange = null
      peer.onnegotiationneeded = null
      peer.onsignalingstatechange = null
      peer.close()
    }

    remoteTrackCleanupRef.current.forEach((cleanup) => cleanup())
    remoteTrackCleanupRef.current = []
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop())
    remoteStreamRef.current = null
    if (mountedRef.current) setRemoteStream(null)
  }, [clearConnectionTimers])

  const handleAccessLost = useCallback(() => {
    runIdRef.current += 1
    fetchControllersRef.current.forEach((controller) => controller.abort())
    closePeerConnection()
    leaseRef.current = null
    setLiveStatus('disconnected')
    setLiveError({
      code: 'access_lost',
      message:
        'This room is no longer available. Camera sharing has been stopped.',
    })
    onAccessLostRef.current?.()
  }, [closePeerConnection, setLiveError, setLiveStatus])

  const handleLeaseLost = useCallback(
    (message?: string) => {
      runIdRef.current += 1
      fetchControllersRef.current.forEach((controller) => controller.abort())
      closePeerConnection()
      leaseRef.current = null
      setLiveStatus('disconnected')
      setLiveError({
        code: 'lease_lost',
        message:
          message ??
          'This tab no longer owns the camera connection. Reconnect to continue here.',
      })
      onLeaseLostRef.current?.()
    },
    [closePeerConnection, setLiveError, setLiveStatus]
  )

  const releaseLease = useCallback(
    (lease: RoomWebRtcLease, useBeacon = false) => {
      const body = JSON.stringify({
        action: 'release',
        clientId: lease.clientId,
        generation: lease.generation,
      })

      if (useBeacon && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(
          signalingUrl,
          new Blob([body], { type: 'application/json' })
        )
        return
      }

      void fetch(signalingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined)
    },
    [signalingUrl]
  )

  const sendSignal = useCallback(
    (
      type: RoomWebRtcSignalType,
      payload: RoomWebRtcSignalPayload,
      negotiationId: string
    ) => {
      const lease = leaseRef.current
      const runId = runIdRef.current
      const isCurrent = () =>
        runId === runIdRef.current && leaseRef.current === lease
      const send = async () => {
        if (!lease || !isCurrent() || signalingBrokenRef.current) return

        const sequence = nextSequenceRef.current
        const body = {
          action: 'signal',
          clientId: lease.clientId,
          generation: lease.generation,
          sequence,
          negotiationId,
          type,
          payload,
        }

        let lastFailure: unknown = null
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (!isCurrent()) return
          const requestStartedAt = Date.now()
          try {
            await postAction(body)
            if (!isCurrent()) return
            nextSequenceRef.current = sequence + 1
            // Enqueue extends the database lease by 45 seconds. Use the request
            // start plus 40 seconds as a conservative local transmission limit.
            lease.expiresAt = new Date(requestStartedAt + 40_000).toISOString()
            return
          } catch (caughtError) {
            if (!isCurrent()) return
            lastFailure = caughtError
            if (
              caughtError instanceof RoomWebRtcRequestError &&
              caughtError.status < 500 &&
              caughtError.status !== 429
            ) {
              break
            }
          }
        }

        throw lastFailure
      }

      const operation = signalQueueRef.current.then(send)
      signalQueueRef.current = operation.catch((caughtError) => {
        if (
          !isCurrent() ||
          (caughtError instanceof DOMException &&
            caughtError.name === 'AbortError') ||
          !leaseRef.current ||
          !enabledRef.current
        ) {
          return
        }
        signalingBrokenRef.current = true
        if (
          caughtError instanceof RoomWebRtcRequestError &&
          caughtError.status === 401
        ) {
          handleAccessLost()
          return
        }
        if (
          caughtError instanceof RoomWebRtcRequestError &&
          (caughtError.code === 'client_lease_lost' ||
            caughtError.status === 409)
        ) {
          handleLeaseLost(caughtError.message)
          return
        }

        setLiveStatus('disconnected')
        setLiveError({
          code: 'signaling',
          message:
            caughtError instanceof Error
              ? caughtError.message
              : 'The partner connection could not be synchronized. Reconnect to try again.',
        })
      })
      return operation
    },
    [
      handleAccessLost,
      handleLeaseLost,
      postAction,
      setLiveError,
      setLiveStatus,
    ]
  )
  useEffect(() => {
    sendSignalRef.current = sendSignal
  }, [sendSignal])

  const flushLocalCandidateBatches = useCallback(() => {
    candidateFlushTimerRef.current = null
    const batches = Array.from(localCandidateBatchesRef.current.entries())
    localCandidateBatchesRef.current.clear()
    for (const [negotiationId, candidates] of batches) {
      if (candidates.length > 0) {
        void sendSignalRef.current('ice', { candidates }, negotiationId)
      }
    }
  }, [])

  const queueLocalCandidate = useCallback(
    (candidate: RoomWebRtcIceCandidate | null) => {
      const negotiationId = outgoingNegotiationIdRef.current
      if (!negotiationId) return

      const candidates =
        localCandidateBatchesRef.current.get(negotiationId) ?? []
      candidates.push(candidate)
      localCandidateBatchesRef.current.set(negotiationId, candidates)

      if (candidate === null || candidates.length >= 64) {
        if (candidateFlushTimerRef.current) {
          clearTimeout(candidateFlushTimerRef.current)
          candidateFlushTimerRef.current = null
        }
        flushLocalCandidateBatches()
      } else if (!candidateFlushTimerRef.current) {
        candidateFlushTimerRef.current = setTimeout(
          flushLocalCandidateBatches,
          ICE_BATCH_DELAY_MS
        )
      }
    },
    [flushLocalCandidateBatches]
  )

  const addRemoteCandidate = useCallback(
    async (peer: RTCPeerConnection, candidate: RoomWebRtcIceCandidate | null) => {
      try {
        await peer.addIceCandidate(candidate)
      } catch (caughtError) {
        if (peer.signalingState !== 'closed') throw caughtError
      }
    },
    []
  )

  const flushRemoteCandidates = useCallback(
    async (negotiationId: string) => {
      const peer = peerRef.current
      if (!peer?.remoteDescription) return
      const candidates =
        remoteCandidateBuffersRef.current.get(negotiationId) ?? []
      remoteCandidateBuffersRef.current.delete(negotiationId)
      for (const candidate of candidates) {
        await addRemoteCandidate(peer, candidate)
      }
    },
    [addRemoteCandidate]
  )

  const acceptRemoteNegotiation = useCallback(
    async (negotiationId: string) => {
      acceptedRemoteNegotiationIdRef.current = negotiationId
      for (const bufferedId of remoteCandidateBuffersRef.current.keys()) {
        if (bufferedId !== negotiationId) {
          remoteCandidateBuffersRef.current.delete(bufferedId)
        }
      }
      await flushRemoteCandidates(negotiationId)
    },
    [flushRemoteCandidates]
  )

  const negotiate = useCallback(
    async (iceRestart: boolean) => {
      const peer = peerRef.current
      const lease = leaseRef.current
      if (!peer || !lease || lease.position !== 'A') return

      if (makingOfferRef.current) {
        pendingIceRestartRef.current =
          pendingIceRestartRef.current || iceRestart
        return
      }

      // B may arrive after the initial offer expired, or refresh before answering.
      // A must replace that unanswered offer rather than wait forever for stable.
      if (iceRestart && peer.signalingState === 'have-local-offer') {
        pendingIceRestartRef.current = false
        pendingLocalOfferIdRef.current = null
        outgoingNegotiationIdRef.current = null
        try {
          await peer.setLocalDescription({ type: 'rollback' })
        } catch {
          if (peerRef.current === peer) void startConnectionRef.current(true)
          return
        }
        if (peerRef.current !== peer) return
      }
      if (peer.signalingState !== 'stable') {
        pendingIceRestartRef.current = pendingIceRestartRef.current || iceRestart
        return
      }

      makingOfferRef.current = true
      const negotiationId = crypto.randomUUID()
      outgoingNegotiationIdRef.current = negotiationId
      pendingLocalOfferIdRef.current = negotiationId

      try {
        const offer = await peer.createOffer({ iceRestart })
        if (peerRef.current !== peer) return
        await peer.setLocalDescription(offer)
        if (peerRef.current !== peer) return
        const sdp = peer.localDescription?.sdp
        if (!sdp) throw new Error('The browser did not create a video offer.')
        await sendSignalRef.current('offer', { sdp }, negotiationId)
      } catch (caughtError) {
        if (peerRef.current === peer) {
          setLiveStatus('disconnected')
          setLiveError({
            code: 'peer_failed',
            message:
              caughtError instanceof Error
                ? caughtError.message
                : 'The video connection could not be negotiated. Reconnect to try again.',
          })
        }
      } finally {
        if (peerRef.current === peer) {
          makingOfferRef.current = false
          if (pendingIceRestartRef.current) {
            pendingIceRestartRef.current = false
            void negotiateRef.current(true)
          }
        }
      }
    },
    [setLiveError, setLiveStatus]
  )
  useEffect(() => {
    negotiateRef.current = negotiate
  }, [negotiate])

  const requestIceRestart = useCallback(() => {
    const peer = peerRef.current
    const lease = leaseRef.current
    if (!peer || !lease || peer.signalingState === 'closed') return

    const credentialExpiry = iceConfigurationRef.current?.expiresAt
    if (
      credentialExpiry &&
      Date.parse(credentialExpiry) <= Date.now() + 30_000
    ) {
      setLiveStatus('reconnecting')
      void startConnectionRef.current(true)
      return
    }

    if (restartAttemptsRef.current >= 2) {
      setLiveStatus('disconnected')
      setLiveError({
        code: 'peer_failed',
        message:
          'The partner video connection was lost. Check your network and reconnect.',
      })
      return
    }

    restartAttemptsRef.current += 1
    setLiveStatus('reconnecting')
    if (lease.position === 'A') {
      void negotiateRef.current(true)
    } else {
      void sendSignalRef.current('restart', {}, crypto.randomUUID())
    }

    if (restartFailureTimerRef.current) {
      clearTimeout(restartFailureTimerRef.current)
    }
    restartFailureTimerRef.current = setTimeout(() => {
      restartFailureTimerRef.current = null
      if (peerRef.current?.connectionState !== 'connected') {
        requestIceRestartRef.current()
      }
    }, RESTART_FAILURE_DELAY_MS)
  }, [setLiveError, setLiveStatus])
  useEffect(() => {
    requestIceRestartRef.current = requestIceRestart
  }, [requestIceRestart])

  const processInboxMessage = useCallback(
    async (message: RoomWebRtcInboxMessage) => {
      const peer = peerRef.current
      const lease = leaseRef.current
      if (!peer || !lease || peer.signalingState === 'closed') return
      const isCurrent = () => peerRef.current === peer && leaseRef.current === lease

      if (Date.parse(message.expiresAt) <= Date.now()) return
      if (message.senderGeneration < highestRemoteGenerationRef.current) return
      if (message.senderGeneration > highestRemoteGenerationRef.current) {
        highestRemoteGenerationRef.current = message.senderGeneration
        ignoredNegotiationIdsRef.current.clear()
        remoteCandidateBuffersRef.current.clear()
      }

      if (message.type === 'restart') {
        if (lease.position === 'A') requestIceRestartRef.current()
        return
      }

      if (message.type === 'ice') {
        if (ignoredNegotiationIdsRef.current.has(message.negotiationId)) return
        if (!('candidates' in message.payload)) return

        if (
          acceptedRemoteNegotiationIdRef.current === message.negotiationId &&
          peer.remoteDescription
        ) {
          for (const candidate of message.payload.candidates) {
            await addRemoteCandidate(peer, candidate)
          }
          return
        }

        const buffers = remoteCandidateBuffersRef.current
        if (!buffers.has(message.negotiationId) && buffers.size >= 8) {
          const oldestNegotiationId = buffers.keys().next().value
          if (typeof oldestNegotiationId === 'string') {
            buffers.delete(oldestNegotiationId)
          }
        }
        const buffered = buffers.get(message.negotiationId) ?? []
        let totalBuffered = Array.from(buffers.values()).reduce(
          (total, candidates) => total + candidates.length,
          0
        )
        for (const candidate of message.payload.candidates) {
          if (totalBuffered < MAX_BUFFERED_REMOTE_CANDIDATES) {
            buffered.push(candidate)
            totalBuffered += 1
          }
        }
        buffers.set(message.negotiationId, buffered)
        return
      }

      if (!('sdp' in message.payload)) return
      if (message.type === 'answer') {
        if (
          pendingLocalOfferIdRef.current !== message.negotiationId ||
          peer.signalingState !== 'have-local-offer'
        ) {
          return
        }

        await peer.setRemoteDescription({
          type: 'answer',
          sdp: message.payload.sdp,
        })
        if (!isCurrent()) return
        pendingLocalOfferIdRef.current = null
        await acceptRemoteNegotiation(message.negotiationId)
        return
      }

      const offerCollision =
        makingOfferRef.current || peer.signalingState !== 'stable'
      const polite = lease.position === 'B'
      if (offerCollision && !polite) {
        ignoredNegotiationIdsRef.current.add(message.negotiationId)
        remoteCandidateBuffersRef.current.delete(message.negotiationId)
        return
      }

      if (offerCollision && peer.signalingState !== 'stable') {
        await peer.setLocalDescription({ type: 'rollback' })
        if (!isCurrent()) return
      }

      await peer.setRemoteDescription({
        type: 'offer',
        sdp: message.payload.sdp,
      })
      if (!isCurrent()) return
      await acceptRemoteNegotiation(message.negotiationId)
      if (!isCurrent()) return
      outgoingNegotiationIdRef.current = message.negotiationId
      const answer = await peer.createAnswer()
      if (!isCurrent()) return
      await peer.setLocalDescription(answer)
      if (!isCurrent()) return
      const sdp = peer.localDescription?.sdp
      if (!sdp) throw new Error('The browser did not create a video answer.')
      await sendSignalRef.current('answer', { sdp }, message.negotiationId)
    },
    [acceptRemoteNegotiation, addRemoteCandidate]
  )

  const acknowledgeMessages = useCallback(
    async (messageIds: string[]) => {
      const lease = leaseRef.current
      if (!lease || messageIds.length === 0) return
      await postAction({
        action: 'ack',
        clientId: lease.clientId,
        generation: lease.generation,
        messageIds,
      })
    },
    [postAction]
  )

  const readInbox = useCallback(async () => {
    if (inboxReadingRef.current) {
      inboxReadAgainRef.current = true
      return
    }

    const lease = leaseRef.current
    if (!lease) return
    const runId = runIdRef.current
    const isCurrent = () => runId === runIdRef.current && leaseRef.current === lease
    inboxReadingRef.current = true

    try {
      do {
        inboxReadAgainRef.current = false
        const activeLease = leaseRef.current
        if (!activeLease) return

        const value = await requestJson(
          `${signalingUrl}?clientId=${encodeURIComponent(
            activeLease.clientId
          )}&generation=${activeLease.generation}`
        )
        if (!isCurrent()) return
        if (!value || typeof value !== 'object') {
          throw new Error('The signaling inbox response was invalid.')
        }

        const response = value as Record<string, unknown>
        if (
          typeof response.revision !== 'number' ||
          !Number.isSafeInteger(response.revision) ||
          response.revision < 0 ||
          !Array.isArray(response.messages) ||
          typeof response.hasMore !== 'boolean'
        ) {
          throw new Error('The signaling inbox response was invalid.')
        }

        const messages = response.messages.map(parseRoomWebRtcInboxMessage)
        if (messages.some((message) => message === null)) {
          throw new Error('A signaling message was invalid.')
        }

        const acknowledge: string[] = []
        for (const message of messages as RoomWebRtcInboxMessage[]) {
          if (!isCurrent()) return
          if (processedMessageIdsRef.current.has(message.id)) {
            acknowledge.push(message.id)
            continue
          }

          try {
            await processInboxMessage(message)
          } catch (caughtError) {
            if (!isCurrent()) return
            // The message is authenticated and schema-validated. A browser SDP
            // rejection makes this negotiation stale; acknowledge it and let a
            // fresh reconnect generation recover instead of retrying forever.
            console.error('[WebRTC] Signal processing failed:', caughtError)
            setLiveError({
              code: 'signaling',
              message:
                'The partner connection became stale. Reconnect to synchronize it.',
            })
          }

          if (!isCurrent()) return
          processedMessageIdsRef.current.add(message.id)
          acknowledge.push(message.id)
        }

        if (processedMessageIdsRef.current.size > MAX_PROCESSED_MESSAGE_IDS) {
          processedMessageIdsRef.current.clear()
          acknowledge.forEach((id) => processedMessageIdsRef.current.add(id))
        }

        if (acknowledge.length > 0) {
          try {
            await acknowledgeMessages(acknowledge)
          } catch (caughtError) {
            if (!isCurrent()) return
            // A later protected read safely retries the acknowledgement.
            if (
              caughtError instanceof RoomWebRtcRequestError &&
              caughtError.status === 401
            ) {
              handleAccessLost()
              return
            }
            if (caughtError instanceof RoomWebRtcRequestError && caughtError.status === 409) {
              handleLeaseLost(caughtError.message)
            }
            // Do not spin through the same full page if its acknowledgement
            // failed. The next bounded poll retries it safely.
            return
          }
        }

        if (response.hasMore) inboxReadAgainRef.current = true
      } while (inboxReadAgainRef.current && isCurrent())
    } catch (caughtError) {
      if (!isCurrent()) return
      if (
        caughtError instanceof DOMException &&
        caughtError.name === 'AbortError'
      ) {
        return
      }
      if (
        caughtError instanceof RoomWebRtcRequestError &&
        caughtError.status === 401
      ) {
        handleAccessLost()
        return
      }
      if (
        caughtError instanceof RoomWebRtcRequestError &&
        caughtError.status === 409
      ) {
        handleLeaseLost(caughtError.message)
        return
      }

      if (peerRef.current?.connectionState !== 'connected') {
        setLiveStatus('reconnecting')
        setLiveError({
          code: 'network',
          message:
            'Signaling is temporarily unavailable. The connection will keep retrying.',
        })
      }
    } finally {
      inboxReadingRef.current = false
    }
  }, [
    acknowledgeMessages,
    handleAccessLost,
    handleLeaseLost,
    processInboxMessage,
    requestJson,
    setLiveError,
    setLiveStatus,
    signalingUrl,
  ])
  useEffect(() => {
    readInboxRef.current = readInbox
  }, [readInbox])

  const createPeerConnection = useCallback(
    (
      stream: MediaStream,
      lease: RoomWebRtcLease,
      iceConfiguration: IceConfigurationResponse
    ) => {
      closePeerConnection()
      const peer = new RTCPeerConnection({
        iceServers: iceConfiguration.iceServers,
        iceTransportPolicy: iceConfiguration.iceTransportPolicy,
        bundlePolicy: 'max-bundle',
      })
      peerRef.current = peer

      peer.ontrack = (event) => {
        if (peerRef.current !== peer || event.track.kind !== 'video') {
          event.track.stop()
          return
        }
        const currentTracks = remoteStreamRef.current?.getTracks() ?? []
        const tracks = currentTracks.filter(
          (track) => track.readyState === 'live' && track.id !== event.track.id
        )
        tracks.push(event.track)
        const nextStream = new MediaStream(tracks)
        remoteStreamRef.current = nextStream
        if (mountedRef.current) setRemoteStream(nextStream)

        const handleEnded = () => {
          const remaining =
            remoteStreamRef.current
              ?.getTracks()
              .filter((track) => track.readyState === 'live') ?? []
          const updated = remaining.length > 0 ? new MediaStream(remaining) : null
          remoteStreamRef.current = updated
          if (mountedRef.current) setRemoteStream(updated)
        }
        event.track.addEventListener('ended', handleEnded)
        remoteTrackCleanupRef.current.push(() =>
          event.track.removeEventListener('ended', handleEnded)
        )
      }

      peer.onicecandidate = (event) => {
        if (peerRef.current !== peer) return
        if (event.candidate?.candidate) {
          const candidate = event.candidate.toJSON()
          queueLocalCandidate({
            candidate: event.candidate.candidate,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
            ...(candidate.usernameFragment === undefined
              ? {}
              : { usernameFragment: candidate.usernameFragment ?? null }),
          })
        } else {
          queueLocalCandidate(null)
        }
      }

      const syncConnectionState = () => {
        if (peerRef.current !== peer) return
        if (peer.connectionState === 'connected') {
          if (disconnectedTimerRef.current) {
            clearTimeout(disconnectedTimerRef.current)
            disconnectedTimerRef.current = null
          }
          if (restartFailureTimerRef.current) {
            clearTimeout(restartFailureTimerRef.current)
            restartFailureTimerRef.current = null
          }
          restartAttemptsRef.current = 0
          setLiveStatus('connected')
          setLiveError(null)
          return
        }

        if (
          peer.connectionState === 'connecting' ||
          peer.connectionState === 'new'
        ) {
          setLiveStatus(
            restartAttemptsRef.current > 0 ? 'reconnecting' : 'connecting'
          )
          return
        }

        if (peer.connectionState === 'disconnected') {
          setLiveStatus('reconnecting')
          if (!disconnectedTimerRef.current) {
            disconnectedTimerRef.current = setTimeout(() => {
              disconnectedTimerRef.current = null
              requestIceRestartRef.current()
            }, DISCONNECTED_RESTART_DELAY_MS)
          }
          return
        }

        if (peer.connectionState === 'failed') {
          requestIceRestartRef.current()
        }
      }

      peer.onconnectionstatechange = syncConnectionState
      peer.oniceconnectionstatechange = syncConnectionState
      peer.onsignalingstatechange = () => {
        if (
          peer.signalingState === 'stable' &&
          pendingIceRestartRef.current
        ) {
          const shouldRestart = pendingIceRestartRef.current
          pendingIceRestartRef.current = false
          void negotiateRef.current(shouldRestart)
        }
      }
      peer.onnegotiationneeded = () => {
        if (lease.position === 'A') void negotiateRef.current(false)
      }

      const videoTracks = stream
        .getVideoTracks()
        .filter((track) => track.readyState === 'live')
      if (videoTracks.length === 0) {
        peer.close()
        peerRef.current = null
        throw new Error('The local camera stream is no longer active.')
      }
      videoTracks.slice(0, 1).forEach((track) => peer.addTrack(track, stream))
      setLiveStatus('connecting')

      if (lease.position === 'A') {
        void negotiateRef.current(false)
      } else {
        // B never chooses the offer role, but this protected request wakes an
        // already-running A after B starts or refreshes.
        void sendSignalRef.current('restart', {}, crypto.randomUUID())
      }
    },
    [
      closePeerConnection,
      queueLocalCandidate,
      setLiveError,
      setLiveStatus,
    ]
  )

  const claimLease = useCallback(
    async (clientId: string, force: boolean) => {
      const value = await postAction({ action: 'claim', clientId, force })
      if (!value || typeof value !== 'object') {
        throw new Error('The camera lease response was invalid.')
      }
      const lease = value as Record<string, unknown>
      if (
        !isPositiveSignalNumber(lease.generation) ||
        !isPositiveSignalNumber(lease.nextSequence) ||
        typeof lease.expiresAt !== 'string' ||
        Number.isNaN(Date.parse(lease.expiresAt)) ||
        !isCaptureSessionPosition(lease.position)
      ) {
        throw new Error('The camera lease response was invalid.')
      }

      return {
        clientId,
        generation: lease.generation,
        position: lease.position,
        nextSequence: lease.nextSequence,
        expiresAt: lease.expiresAt,
      } satisfies RoomWebRtcLease
    },
    [postAction]
  )

  const startConnection = useCallback(
    async (force: boolean) => {
      const stream = localStreamRef.current
      if (!enabledRef.current || !roomActiveRef.current || !stream) return
      if (typeof RTCPeerConnection === 'undefined') {
        setLiveStatus('unsupported')
        setLiveError({
          code: 'unsupported',
          message:
            'This browser does not support live peer video. Try a current version of Safari, Chrome, Firefox, or Edge.',
        })
        return
      }

      const runId = ++runIdRef.current
      closePeerConnection()
      signalingBrokenRef.current = false
      signalQueueRef.current = Promise.resolve()
      highestRemoteGenerationRef.current = 0
      processedMessageIdsRef.current.clear()
      setLiveStatus('connecting')
      setLiveError(null)

      const previousLease = leaseRef.current
      leaseRef.current = null
      fetchControllersRef.current.forEach((controller) => controller.abort())
      fetchControllersRef.current.clear()
      if (previousLease && !force) releaseLease(previousLease)

      let claimedLease: RoomWebRtcLease | null = null
      try {
        const captureValue = await requestJson(
          `/api/rooms/${encodeURIComponent(roomCode)}/capture-session`,
          { method: 'POST' }
        )
        if (runId !== runIdRef.current) return
        const captureSession =
          captureValue && typeof captureValue === 'object'
            ? (captureValue as { session?: { participantPosition?: unknown } })
                .session
            : null
        if (!isCaptureSessionPosition(captureSession?.participantPosition)) {
          throw new Error('The paired camera session response was invalid.')
        }

        const clientId = clientIdRef.current ?? crypto.randomUUID()
        clientIdRef.current = clientId
        let lease: RoomWebRtcLease
        try {
          lease = await claimLease(clientId, force)
        } catch (caughtError) {
          if (
            !force &&
            !reloadTakeoverAttemptedRef.current &&
            isReloadNavigation() &&
            caughtError instanceof RoomWebRtcRequestError &&
            caughtError.code === 'client_lease_active'
          ) {
            reloadTakeoverAttemptedRef.current = true
            lease = await claimLease(clientId, true)
          } else {
            throw caughtError
          }
        }
        claimedLease = lease

        if (runId !== runIdRef.current) {
          releaseLease(lease)
          claimedLease = null
          return
        }
        if (lease.position !== captureSession.participantPosition) {
          releaseLease(lease)
          claimedLease = null
          throw new Error('The server returned inconsistent camera roles.')
        }

        const iceValue = await requestJson(
          `/api/rooms/${encodeURIComponent(roomCode)}/webrtc/ice`
        )
        if (!isIceConfiguration(iceValue)) {
          releaseLease(lease)
          claimedLease = null
          throw new Error('The ICE configuration response was invalid.')
        }
        if (runId !== runIdRef.current) {
          releaseLease(lease)
          claimedLease = null
          return
        }

        leaseRef.current = lease
        claimedLease = null
        nextSequenceRef.current = lease.nextSequence
        iceConfigurationRef.current = iceValue
        setParticipantPosition(lease.position)
        setLeaseEpoch((current) => current + 1)
        createPeerConnection(stream, lease, iceValue)
        void readInboxRef.current()
      } catch (caughtError) {
        if (claimedLease) releaseLease(claimedLease)
        if (runId !== runIdRef.current) return
        const activeLease = leaseRef.current
        if (activeLease) {
          leaseRef.current = null
          releaseLease(activeLease)
          closePeerConnection()
        }
        if (
          caughtError instanceof DOMException &&
          caughtError.name === 'AbortError'
        ) {
          return
        }
        if (
          caughtError instanceof RoomWebRtcRequestError &&
          caughtError.status === 401
        ) {
          handleAccessLost()
          return
        }
        if (
          caughtError instanceof RoomWebRtcRequestError &&
          caughtError.code === 'client_lease_active'
        ) {
          setLiveStatus('disconnected')
          setLiveError({ code: 'another_tab', message: caughtError.message })
          return
        }

        const configurationFailure =
          caughtError instanceof RoomWebRtcRequestError &&
          caughtError.code === 'ice_configuration_unavailable'
        setLiveStatus('disconnected')
        setLiveError({
          code: configurationFailure ? 'configuration' : 'network',
          message:
            caughtError instanceof Error
              ? caughtError.message
              : 'The partner camera connection could not start. Reconnect to try again.',
        })
      }
    },
    [
      claimLease,
      closePeerConnection,
      createPeerConnection,
      handleAccessLost,
      releaseLease,
      requestJson,
      roomCode,
      setLiveError,
      setLiveStatus,
    ]
  )
  useEffect(() => {
    startConnectionRef.current = startConnection
  }, [startConnection])

  const stopConnection = useCallback(
    (release = true) => {
      runIdRef.current += 1
      fetchControllersRef.current.forEach((controller) => controller.abort())
      fetchControllersRef.current.clear()
      closePeerConnection()
      const lease = leaseRef.current
      leaseRef.current = null
      if (lease && release) releaseLease(lease)
      signalingBrokenRef.current = false
      signalQueueRef.current = Promise.resolve()
      setParticipantPosition(null)
      setLiveStatus('idle')
      setLiveError(null)
    },
    [closePeerConnection, releaseLease, setLiveError, setLiveStatus]
  )

  useEffect(() => {
    if (enabled && roomActive && localStream) {
      void startConnection(false)
      return () => stopConnection(true)
    }

    const stopTimer = window.setTimeout(() => stopConnection(true), 0)
    return () => window.clearTimeout(stopTimer)
  }, [enabled, localStream, roomActive, startConnection, stopConnection])

  useEffect(() => {
    const lease = leaseRef.current
    if (!lease || leaseEpoch === 0) return

    const heartbeat = async () => {
      const activeLease = leaseRef.current
      if (!activeLease) return
      const runId = runIdRef.current
      try {
        const result = await postAction({
          action: 'heartbeat',
          clientId: activeLease.clientId,
          generation: activeLease.generation,
        })
        if (runId !== runIdRef.current || leaseRef.current !== activeLease) return
        const expiresAt = (result as { expiresAt?: unknown } | null)?.expiresAt
        if (typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt))) {
          activeLease.expiresAt = expiresAt
        }
      } catch (caughtError) {
        if (runId !== runIdRef.current || leaseRef.current !== activeLease) return
        if (
          caughtError instanceof RoomWebRtcRequestError &&
          caughtError.status === 409
        ) {
          handleLeaseLost(caughtError.message)
        } else if (
          caughtError instanceof RoomWebRtcRequestError &&
          caughtError.status === 401
        ) {
          handleAccessLost()
        }
      }
    }

    const poll = () => {
      if (document.visibilityState === 'visible') void readInboxRef.current()
    }
    const recover = () => {
      void readInboxRef.current()
      if (peerRef.current?.connectionState !== 'connected') {
        requestIceRestartRef.current()
      }
    }

    const heartbeatId = window.setInterval(
      () => void heartbeat(),
      HEARTBEAT_INTERVAL_MS
    )
    const pollId = window.setInterval(poll, INBOX_POLL_INTERVAL_MS)
    const leaseExpiryId = window.setInterval(() => {
      const activeLease = leaseRef.current
      if (activeLease && Date.parse(activeLease.expiresAt) <= Date.now()) {
        handleLeaseLost('Camera sharing paused because this tab could not renew its connection. Check your network and reconnect.')
      }
    }, 1_000)
    window.addEventListener('online', recover)
    window.addEventListener('focus', poll)
    document.addEventListener('visibilitychange', poll)

    return () => {
      window.clearInterval(heartbeatId)
      window.clearInterval(pollId)
      window.clearInterval(leaseExpiryId)
      window.removeEventListener('online', recover)
      window.removeEventListener('focus', poll)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [
    handleAccessLost,
    handleLeaseLost,
    leaseEpoch,
    postAction,
  ])

  useEffect(() => {
    if (leaseRef.current) void readInboxRef.current()
  }, [signalingSignalVersion, subscriptionVersion])

  useEffect(() => {
    const releaseOnPageHide = () => {
      const lease = leaseRef.current
      if (lease) releaseLease(lease, true)
      stopConnection(false)
    }
    window.addEventListener('pagehide', releaseOnPageHide)
    return () => window.removeEventListener('pagehide', releaseOnPageHide)
  }, [releaseLease, stopConnection])

  useEffect(() => {
    const fetchControllers = fetchControllersRef.current
    return () => {
      runIdRef.current += 1
      fetchControllers.forEach((controller) => controller.abort())
      clearConnectionTimers()
      const lease = leaseRef.current
      if (lease) releaseLease(lease, true)
      leaseRef.current = null
      const peer = peerRef.current
      if (peer) {
        peer.ontrack = null
        peer.onicecandidate = null
        peer.onconnectionstatechange = null
        peer.oniceconnectionstatechange = null
        peer.onnegotiationneeded = null
        peer.onsignalingstatechange = null
        peer.close()
      }
      remoteTrackCleanupRef.current.forEach((cleanup) => cleanup())
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [clearConnectionTimers, releaseLease])

  const reconnect = useCallback(() => {
    if (!enabledRef.current || !roomActiveRef.current || !localStreamRef.current) {
      return
    }
    void startConnectionRef.current(true)
  }, [])

  return {
    status,
    error,
    remoteStream,
    participantPosition,
    reconnect,
  }
}
