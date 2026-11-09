'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DualCameraStage } from '@/components/camera/dual-camera-stage'
import type { UseCameraReturn } from '@/hooks/use-camera'
import type { UseRoomWebRtcReturn } from '@/hooks/use-room-webrtc'
import {
  CAPTURE_COUNTDOWN_MS,
  CAPTURE_JPEG_QUALITY,
  estimateServerClock,
  getCaptureImageDimensions,
  getMonotonicCaptureDeadline,
  isSynchronizedCaptureState,
  shouldScheduleAttempt,
  type CaptureAttemptState,
  type ServerClockEstimate,
  type ServerClockSample,
  type SynchronizedCaptureState,
  type SynchronizedCaptureUiState,
} from '@/lib/capture-session'
import { SHARED_PHOTO_BUCKET } from '@/lib/shared-photos'
import { createClient } from '@/lib/supabase/client'

interface SynchronizedCaptureViewProps {
  roomCode: string
  camera: UseCameraReturn
  webrtc: UseRoomWebRtcReturn
  localLabel: string
  remoteLabel: string
  captureSignalVersion: number
  subscriptionVersion: number
  onCaptureActivityChange?: (active: boolean) => void
}

interface PendingCapture {
  blob: Blob
  capturedAt: string
  timing: {
    scheduledDeltaMs: number
    monotonicLatenessMs: number
    clockOffsetMs: number
    clockRoundTripMs: number
    recovery: boolean
    captureDurationMs: number
    jpegEncodingMs: number
    uploadCompletedAt?: string
  }
}

const ACTIVE_RECOVERY_POLL_INTERVAL_MS = 2_000
const IDLE_RECOVERY_POLL_INTERVAL_MS = 10_000
const MAX_SAFE_LATE_CAPTURE_MS = 1_500

function logCapturePerformance(
  attemptId: string,
  event: string,
  measurements: Record<string, string | number | boolean | null | undefined>
) {
  console.info('[Capture Performance]', { attemptId, event, ...measurements })
}

function responseMessage(body: unknown, fallback: string) {
  return body &&
    typeof body === 'object' &&
    typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : fallback
}

function getUiState(
  state: SynchronizedCaptureState | null,
  localPosition: 'A' | 'B' | null,
  connected: boolean,
  uploading: boolean,
  recoverableFailure: boolean
): SynchronizedCaptureUiState {
  if (recoverableFailure) return 'recoverable_failure'
  if (state?.phase === 'completed') return 'session_completed'
  if (!state || !connected) return 'waiting_participants'
  if (!state.currentAttempt) return 'waiting_readiness'
  if (uploading) return 'uploading'

  const own = state.currentAttempt.photos.find(
    (photo) => photo.position === localPosition
  )
  const partner = state.currentAttempt.photos.find(
    (photo) => photo.position !== localPosition
  )
  if (own?.status === 'verified' && partner?.status !== 'verified') {
    return 'waiting_partner_upload'
  }
  if (state.currentAttempt.resultState === 'complete') return 'moment_completed'

  const remaining = Date.parse(state.currentAttempt.scheduledAt) - state.serverTimeMs
  if (remaining > CAPTURE_COUNTDOWN_MS) return 'scheduled'
  if (remaining > 0) return 'countdown'
  return 'capturing'
}

export function SynchronizedCaptureView({
  roomCode,
  camera,
  webrtc,
  localLabel,
  remoteLabel,
  captureSignalVersion,
  subscriptionVersion,
  onCaptureActivityChange,
}: SynchronizedCaptureViewProps) {
  const [captureState, setCaptureState] =
    useState<SynchronizedCaptureState | null>(null)
  const [clock, setClock] = useState<ServerClockEstimate | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [flash, setFlash] = useState(false)
  const [hasPendingCapture, setHasPendingCapture] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoverableFailure, setRecoverableFailure] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mountedRef = useRef(true)
  const clockSamplesRef = useRef<ServerClockSample[]>([])
  const handledAttemptRef = useRef<string | null>(null)
  const pendingCapturesRef = useRef(new Map<string, PendingCapture>())
  const scheduleCancelRef = useRef<(() => void) | null>(null)
  const refreshPromiseRef = useRef<Promise<SynchronizedCaptureState> | null>(null)
  const stateSourceRef = useRef('initial')
  const receivedAttemptIdsRef = useRef(new Set<string>())
  const countdownStartedAttemptIdsRef = useRef(new Set<string>())

  const localPosition = captureState?.participantPosition ?? webrtc.participantPosition
  const bothCamerasConnected =
    camera.status === 'active' &&
    webrtc.status === 'connected' &&
    Boolean(webrtc.remoteStream && webrtc.clientLease)
  const uiState = getUiState(
    captureState,
    localPosition,
    bothCamerasConnected,
    isUploading,
    recoverableFailure
  )

  const sampleClock = useCallback(async () => {
    const clientWallSendMs = Date.now()
    const response = await fetch(
      `/api/rooms/${encodeURIComponent(roomCode)}/capture-session?clock=1`,
      { cache: 'no-store' }
    )
    const clientWallReceiveMs = Date.now()
    const body = await response.json().catch(() => null) as
      | { serverTimeMs?: unknown; error?: string }
      | null
    if (
      !response.ok ||
      typeof body?.serverTimeMs !== 'number' ||
      !Number.isFinite(body.serverTimeMs)
    ) {
      throw new Error(responseMessage(body, 'Server clock could not be synchronized.'))
    }
    clockSamplesRef.current = [
      ...clockSamplesRef.current.slice(-4),
      { clientWallSendMs, clientWallReceiveMs, serverTimeMs: body.serverTimeMs },
    ]
    const estimate = estimateServerClock(clockSamplesRef.current)
    if (estimate) setClock(estimate)
    return estimate
  }, [roomCode])

  const refreshState = useCallback((source = 'refresh') => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current
    const refresh = (async () => {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(roomCode)}/capture-session?capture=1`,
        { cache: 'no-store' }
      )
      const body = await response.json().catch(() => null) as
        | { capture?: unknown; error?: string }
        | null
      if (!response.ok || !isSynchronizedCaptureState(body?.capture)) {
        throw new Error(responseMessage(body, 'Capture state could not be loaded.'))
      }

      if (mountedRef.current) {
        stateSourceRef.current = source
        setCaptureState(body.capture)
      }
      return body.capture
    })()
    refreshPromiseRef.current = refresh
    void refresh.then(
      () => {
        if (refreshPromiseRef.current === refresh) refreshPromiseRef.current = null
      },
      () => {
        if (refreshPromiseRef.current === refresh) refreshPromiseRef.current = null
      }
    )
    return refresh
  }, [roomCode])

  const mutateCapture = useCallback(async (
    action: 'ready' | 'not_ready' | 'restart'
  ) => {
    const lease = webrtc.clientLease
    if (!lease) throw new Error('Reconnect your camera before continuing.')
    const response = await fetch(
      `/api/rooms/${encodeURIComponent(roomCode)}/capture-session`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          clientId: lease.clientId,
          generation: lease.generation,
        }),
      }
    )
    const body = await response.json().catch(() => null) as
      | { capture?: unknown; error?: string }
      | null
    if (!response.ok || !isSynchronizedCaptureState(body?.capture)) {
      throw new Error(responseMessage(body, 'Capture state could not be updated.'))
    }
    stateSourceRef.current = `mutation:${action}`
    setCaptureState(body.capture)
  }, [roomCode, webrtc.clientLease])

  const uploadCapture = useCallback(async (
    attempt: CaptureAttemptState,
    pending: PendingCapture
  ) => {
    const lease = webrtc.clientLease
    if (!lease) throw new Error('This tab lost the camera session. Reconnect to retry.')
    setIsUploading(true)
    setError(null)
    const pipelineStartedAt = performance.now()
    try {
      const base = {
        attemptId: attempt.attemptId,
        clientId: lease.clientId,
        generation: lease.generation,
      }
      const reserveStartedAt = performance.now()
      const reserveResponse = await fetch(
        `/api/rooms/${encodeURIComponent(roomCode)}/capture-session/image`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...base,
            size: pending.blob.size,
            mimeType: 'image/jpeg',
          }),
        }
      )
      const reservation = await reserveResponse.json().catch(() => null) as
        | {
            status?: unknown
            upload?: { path?: unknown; token?: unknown }
            error?: string
          }
        | null
      if (!reserveResponse.ok) {
        throw new Error(responseMessage(reservation, 'Photo upload could not start.'))
      }
      const reservationMs = performance.now() - reserveStartedAt

      let storageUploadMs = 0
      if (reservation?.status === 'upload') {
        if (
          typeof reservation.upload?.path !== 'string' ||
          typeof reservation.upload.token !== 'string'
        ) {
          throw new Error('Photo upload could not start.')
        }
        const storageUploadStartedAt = performance.now()
        const { error: uploadError } = await createClient().storage
          .from(SHARED_PHOTO_BUCKET)
          .uploadToSignedUrl(
            reservation.upload.path,
            reservation.upload.token,
            pending.blob,
            { contentType: 'image/jpeg' }
          )
        // A response-loss retry may report an existing object. Verification is
        // intentionally attempted anyway and checks the actual private bytes.
        if (uploadError && !uploadError.message.toLowerCase().includes('exist')) {
          throw uploadError
        }
        storageUploadMs = performance.now() - storageUploadStartedAt
      }

      pending.timing.uploadCompletedAt = clock
        ? new Date(Date.now() + clock.offsetMs).toISOString()
        : new Date().toISOString()
      const verificationStartedAt = performance.now()
      const verifyResponse = await fetch(
        `/api/rooms/${encodeURIComponent(roomCode)}/capture-session/image`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...base,
            capturedAt: pending.capturedAt,
            timing: pending.timing,
          }),
        }
      )
      const verified = await verifyResponse.json().catch(() => null) as
        | {
            capture?: unknown
            error?: string
            performance?: {
              verificationMs?: unknown
              databaseTransactionMs?: unknown
              stateLoadMs?: unknown
              secondUploadToNextScheduleMs?: unknown
            }
          }
        | null
      const verificationRoundTripMs = performance.now() - verificationStartedAt
      if (!verifyResponse.ok) {
        throw new Error(responseMessage(verified, 'Photo verification failed.'))
      }
      pendingCapturesRef.current.delete(attempt.attemptId)
      setHasPendingCapture(pendingCapturesRef.current.size > 0)
      if (isSynchronizedCaptureState(verified?.capture)) {
        stateSourceRef.current = 'verification-response'
        setCaptureState(verified.capture)
      } else {
        await refreshState('verification-fallback')
      }
      logCapturePerformance(attempt.attemptId, 'upload_verified', {
        participantPosition: localPosition,
        reservationMs: Math.round(reservationMs * 100) / 100,
        storageUploadMs: Math.round(storageUploadMs * 100) / 100,
        verificationRoundTripMs: Math.round(verificationRoundTripMs * 100) / 100,
        totalPipelineMs: Math.round((performance.now() - pipelineStartedAt) * 100) / 100,
        serverVerificationMs:
          typeof verified?.performance?.verificationMs === 'number'
            ? verified.performance.verificationMs
            : null,
        databaseTransactionMs:
          typeof verified?.performance?.databaseTransactionMs === 'number'
            ? verified.performance.databaseTransactionMs
            : null,
        serverStateLoadMs:
          typeof verified?.performance?.stateLoadMs === 'number'
            ? verified.performance.stateLoadMs
            : null,
        secondUploadToNextScheduleMs:
          typeof verified?.performance?.secondUploadToNextScheduleMs === 'number'
            ? verified.performance.secondUploadToNextScheduleMs
            : null,
      })
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Photo upload failed. Your captured photo is still ready to retry.'
      )
      throw caughtError
    } finally {
      if (mountedRef.current) setIsUploading(false)
    }
  }, [clock, localPosition, refreshState, roomCode, webrtc.clientLease])

  const captureAtDeadline = useCallback(async (
    attempt: CaptureAttemptState,
    deadline: number,
    recovery = false
  ) => {
    const video = camera.videoRef.current
    const canvas = canvasRef.current
    const stream = camera.streamRef.current
    if (
      !video ||
      !canvas ||
      !stream?.getVideoTracks().some((track) => track.readyState === 'live') ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0 ||
      !clock
    ) {
      throw new Error('Your camera was not ready at the capture moment. Restart this moment together.')
    }

    const actualPerformanceNow = performance.now()
    const estimatedServerCaptureMs = Date.now() + clock.offsetMs
    const dimensions = getCaptureImageDimensions(video.videoWidth, video.videoHeight)
    if (!dimensions) throw new Error('The camera reported an invalid photo size.')
    const captureStartedAt = performance.now()
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Photo capture is unavailable in this browser.')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const captureDurationMs = performance.now() - captureStartedAt
    setFlash(true)
    window.setTimeout(() => mountedRef.current && setFlash(false), 260)

    const encodingStartedAt = performance.now()
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result
          ? resolve(result)
          : reject(new Error('The camera could not create a JPEG photo.')),
        'image/jpeg',
        CAPTURE_JPEG_QUALITY
      )
    })
    const jpegEncodingMs = performance.now() - encodingStartedAt
    const scheduledMs = Date.parse(attempt.scheduledAt)
    const pending: PendingCapture = {
      blob,
      capturedAt: new Date(estimatedServerCaptureMs).toISOString(),
      timing: {
        scheduledDeltaMs: estimatedServerCaptureMs - scheduledMs,
        monotonicLatenessMs: actualPerformanceNow - deadline,
        clockOffsetMs: clock.offsetMs,
        clockRoundTripMs: clock.roundTripMs,
        recovery,
        captureDurationMs,
        jpegEncodingMs,
      },
    }
    logCapturePerformance(attempt.attemptId, 'captured_and_encoded', {
      participantPosition: localPosition,
      captureDurationMs: Math.round(captureDurationMs * 100) / 100,
      jpegEncodingMs: Math.round(jpegEncodingMs * 100) / 100,
      outputWidth: dimensions.width,
      outputHeight: dimensions.height,
      jpegSizeBytes: blob.size,
      scheduledLatenessMs: Math.round((actualPerformanceNow - deadline) * 100) / 100,
      recovery,
    })
    pendingCapturesRef.current.set(attempt.attemptId, pending)
    setHasPendingCapture(true)
    await uploadCapture(attempt, pending)
  }, [camera.streamRef, camera.videoRef, clock, localPosition, uploadCapture])

  useEffect(() => {
    const attempt = captureState?.currentAttempt
    if (
      attempt &&
      handledAttemptRef.current === attempt.attemptId &&
      scheduleCancelRef.current &&
      camera.status === 'active'
    ) {
      return
    }
    scheduleCancelRef.current?.()
    scheduleCancelRef.current = null
    if (!attempt || !clock || !localPosition || camera.status !== 'active') return
    const ownPhoto = attempt.photos.find((photo) => photo.position === localPosition)
    if (!ownPhoto || !shouldScheduleAttempt(
      handledAttemptRef.current,
      attempt.attemptId,
      ownPhoto.status
    )) return

    const serverRemaining = Date.parse(attempt.scheduledAt) - captureState.serverTimeMs
    if (serverRemaining < -MAX_SAFE_LATE_CAPTURE_MS) {
      handledAttemptRef.current = attempt.attemptId
      queueMicrotask(() => {
        if (!mountedRef.current) return
        setRecoverableFailure(true)
        setError('This capture moment was missed. Restart it together so neither photo is assigned to the wrong attempt.')
      })
      return
    }

    handledAttemptRef.current = attempt.attemptId
    queueMicrotask(() => {
      if (mountedRef.current) setRecoverableFailure(false)
    })
    const deadline = getMonotonicCaptureDeadline(
      Date.parse(attempt.scheduledAt),
      clock,
      Date.now(),
      performance.now()
    )
    let timer: ReturnType<typeof setTimeout> | null = null
    let frame = 0
    let cancelled = false
    const previousCompletedAt = [...captureState.moments]
      .reverse()
      .find((moment) => moment.status === 'complete')?.attempt?.completedAt
    const tick = () => {
      if (cancelled) return
      const remaining = deadline - performance.now()
      const nextCountdown =
        remaining > 0 && remaining <= CAPTURE_COUNTDOWN_MS
          ? Math.max(1, Math.ceil(remaining / 1000))
          : null
      setCountdown(nextCountdown)
      if (
        nextCountdown !== null &&
        !countdownStartedAttemptIdsRef.current.has(attempt.attemptId)
      ) {
        countdownStartedAttemptIdsRef.current.add(attempt.attemptId)
        const estimatedServerNow = Date.now() + clock.offsetMs
        logCapturePerformance(attempt.attemptId, 'countdown_started', {
          scheduleToCountdownMs:
            Math.round((estimatedServerNow - Date.parse(attempt.createdAt)) * 100) / 100,
          previousMomentCompleteToCountdownMs: previousCompletedAt
            ? Math.round((estimatedServerNow - Date.parse(previousCompletedAt)) * 100) / 100
            : null,
          clockRoundTripMs: Math.round(clock.roundTripMs * 100) / 100,
        })
      }
      if (remaining <= 0) {
        scheduleCancelRef.current = null
        void captureAtDeadline(attempt, deadline).catch((captureError: unknown) => {
          if (!mountedRef.current) return
          setRecoverableFailure(true)
          setError(captureError instanceof Error ? captureError.message : 'The photo could not be captured.')
        })
        return
      }
      if (remaining > 100) {
        timer = setTimeout(tick, Math.min(250, remaining - 75))
      } else {
        frame = requestAnimationFrame(tick)
      }
    }
    tick()
    scheduleCancelRef.current = () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (frame) cancelAnimationFrame(frame)
      setCountdown(null)
    }
  }, [camera.status, captureAtDeadline, captureState, clock, localPosition])

  useEffect(() => {
    const attempt = captureState?.currentAttempt
    if (!attempt || !clock || receivedAttemptIdsRef.current.has(attempt.attemptId)) return
    receivedAttemptIdsRef.current.add(attempt.attemptId)
    logCapturePerformance(attempt.attemptId, 'attempt_received', {
      source: stateSourceRef.current,
      scheduleToClientStateMs:
        Math.round(
          (Date.now() + clock.offsetMs - Date.parse(attempt.createdAt)) * 100
        ) / 100,
      timeUntilCaptureMs:
        Math.round(
          (Date.parse(attempt.scheduledAt) - (Date.now() + clock.offsetMs)) * 100
        ) / 100,
      clockRoundTripMs: Math.round(clock.roundTripMs * 100) / 100,
    })
  }, [captureState?.currentAttempt, clock])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      scheduleCancelRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (camera.status !== 'active' || !webrtc.clientLease) return
    let active = true
    const synchronize = async () => {
      try {
        await Promise.all([
          clockSamplesRef.current.length === 0 ? sampleClock() : Promise.resolve(),
          refreshState('initial-sync'),
        ])
        if (active) setError(null)
        for (
          let index = clockSamplesRef.current.length;
          index < 3 && active;
          index += 1
        ) {
          await sampleClock()
        }
      } catch (syncError) {
        if (active) {
          setError(syncError instanceof Error ? syncError.message : 'Clock synchronization failed.')
        }
      }
    }
    void synchronize()
    return () => { active = false }
  }, [camera.status, refreshState, sampleClock, webrtc.clientLease])

  useEffect(() => {
    if (!webrtc.clientLease) return
    void refreshState('realtime-or-subscription').catch(() => undefined)
  }, [captureSignalVersion, refreshState, subscriptionVersion, webrtc.clientLease])

  useEffect(() => {
    if (!webrtc.clientLease) return
    const needsFastRecoveryPoll =
      uiState === 'waiting_partner_upload' ||
      (uiState === 'waiting_readiness' &&
        Boolean(captureState?.members.some((member) => member.ready)))
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshState('recovery-poll').catch(() => undefined)
      }
    }
    const interval = window.setInterval(
      refreshIfVisible,
      needsFastRecoveryPoll
        ? ACTIVE_RECOVERY_POLL_INTERVAL_MS
        : IDLE_RECOVERY_POLL_INTERVAL_MS
    )
    const clockInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void sampleClock().catch(() => undefined)
      }
    }, 15_000)
    window.addEventListener('focus', refreshIfVisible)
    window.addEventListener('online', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.clearInterval(interval)
      window.clearInterval(clockInterval)
      window.removeEventListener('focus', refreshIfVisible)
      window.removeEventListener('online', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [captureState?.members, refreshState, sampleClock, uiState, webrtc.clientLease])

  useEffect(() => {
    onCaptureActivityChange?.(
      uiState === 'scheduled' ||
      uiState === 'countdown' ||
      uiState === 'capturing' ||
      uiState === 'uploading' ||
      uiState === 'waiting_partner_upload'
    )
  }, [onCaptureActivityChange, uiState])

  const ownMember = captureState?.members.find(
    (member) => member.position === localPosition
  )
  const partnerMember = captureState?.members.find(
    (member) => member.position !== localPosition
  )
  const latestCompletedMoment = useMemo(
    () => [...(captureState?.moments ?? [])]
      .reverse()
      .find((moment) => moment.status === 'complete') ?? null,
    [captureState?.moments]
  )
  const momentNumber = captureState?.currentMoment ??
    Math.min((captureState?.completedMomentCount ?? 0) + 1, 6)
  const verifiedPhotoCount = captureState?.currentAttempt?.photos.filter(
    (photo) => photo.status === 'verified'
  ).length ?? 0
  const isMissingOnlyRecovery = verifiedPhotoCount === 1

  const toggleReady = async () => {
    if (!bothCamerasConnected && !ownMember?.ready) {
      setError('Both live camera previews must be connected before you can get ready.')
      return
    }
    setIsMutating(true)
    setError(null)
    try {
      const resumeReadyPair = Boolean(
        ownMember?.ready &&
        partnerMember?.ready &&
        bothCamerasConnected &&
        !captureState?.currentAttempt
      )
      await mutateCapture(
        ownMember?.ready && !resumeReadyPair ? 'not_ready' : 'ready'
      )
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Readiness could not be updated.')
    } finally {
      setIsMutating(false)
    }
  }

  const restartMoment = async () => {
    setIsMutating(true)
    setError(null)
    try {
      await mutateCapture('restart')
      handledAttemptRef.current = null
      setRecoverableFailure(false)
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : 'The moment could not be restarted.')
    } finally {
      setIsMutating(false)
    }
  }

  const retryUpload = async () => {
    const attempt = captureState?.currentAttempt
    const pending = attempt ? pendingCapturesRef.current.get(attempt.attemptId) : null
    if (!attempt || !pending) return
    try {
      await uploadCapture(attempt, pending)
      setRecoverableFailure(false)
    } catch {
      // uploadCapture retains the Blob and sets actionable copy.
    }
  }

  if (camera.status !== 'active') {
    return (
      <section className="flex w-full flex-col items-center gap-6" aria-labelledby="sync-camera-title">
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-6 text-center">
          <div className="max-w-md">
            <h2 id="sync-camera-title" className="text-xl font-semibold">Bring both cameras into the booth</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              Each of you captures your own camera at the same six scheduled moments. Video only—microphones stay off.
            </p>
          </div>
        </div>
        {camera.error && <p className="text-sm text-[var(--error)]" role="alert">{camera.error.message}</p>}
        <button
          type="button"
          onClick={() => void camera.startCamera()}
          disabled={camera.status === 'requesting'}
          className="min-h-11 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] px-8 py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          {camera.status === 'requesting' ? 'Opening Camera…' : camera.status === 'idle' ? 'Share My Camera' : 'Try Camera Again'}
        </button>
      </section>
    )
  }

  return (
    <section className="flex w-full flex-col gap-5" aria-labelledby="sync-capture-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="sync-capture-title" className="text-2xl font-bold">Moment {momentNumber} of 6</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]" aria-live="polite">
            {uiState === 'waiting_participants' && 'Waiting for both live cameras'}
            {uiState === 'waiting_readiness' && (partnerMember?.ready ? 'Your partner is ready' : 'Ready up when both previews are live')}
            {uiState === 'scheduled' && 'Capture time is locked on both devices'}
            {uiState === 'countdown' && 'Look at your own camera—capture is automatic'}
            {uiState === 'capturing' && 'Capturing this moment…'}
            {uiState === 'uploading' && 'Securing your photo…'}
            {uiState === 'waiting_partner_upload' && 'Your photo is safe. Waiting for your partner…'}
            {uiState === 'moment_completed' && 'Both photos are in'}
            {uiState === 'session_completed' && 'All twelve photos are safely stored'}
            {uiState === 'recoverable_failure' && 'This moment needs a quick recovery'}
          </p>
        </div>
        {clock && (
          <span className="text-xs tabular-nums text-[var(--text-tertiary)]" title="Best observed clock synchronization round trip">
            Clock sync ±{Math.ceil(clock.roundTripMs / 2)} ms network bound
          </span>
        )}
      </div>

      <div className="grid grid-cols-6 gap-2" aria-label={`${captureState?.completedMomentCount ?? 0} of 6 moments complete`}>
        {Array.from({ length: 6 }, (_, index) => {
          const moment = captureState?.moments[index]
          return (
            <div key={index} className="flex flex-col gap-1.5">
              <div className={`h-1.5 rounded-full ${moment?.status === 'complete' ? 'bg-[var(--success)]' : moment?.status === 'active' ? 'bg-[var(--secondary)]' : 'bg-[var(--border-active)]'}`} />
              <span className="text-center text-[0.6875rem] tabular-nums text-[var(--text-tertiary)]">{index + 1}</span>
            </div>
          )
        })}
      </div>

      <DualCameraStage
        localVideoRef={camera.videoRef}
        remoteStream={webrtc.remoteStream}
        connectionStatus={webrtc.status}
        connectionError={webrtc.error}
        localLabel={localLabel}
        remoteLabel={remoteLabel}
        variant="paired"
      >
        {(countdown !== null || flash) && (
          <div className={`absolute inset-0 z-20 flex items-center justify-center rounded-xl ${flash ? 'bg-white' : 'bg-black/45'} transition-opacity`} aria-live="assertive" aria-atomic="true">
            {!flash && <span className="text-[clamp(5rem,22vw,8rem)] font-bold tabular-nums text-white drop-shadow-lg">{countdown}</span>}
          </div>
        )}
      </DualCameraStage>
      <canvas ref={canvasRef} className="hidden" />

      <div className="grid grid-cols-2 gap-3" aria-label="Participant readiness">
        {[{ position: localPosition, label: localLabel, member: ownMember }, { position: localPosition === 'A' ? 'B' : 'A', label: remoteLabel, member: partnerMember }].map((item) => (
          <div key={item.position ?? item.label} className="flex min-w-0 items-center gap-2 border-y border-[var(--border)] py-3">
            <span className={`size-2.5 shrink-0 rounded-full ${item.member?.ready ? 'bg-[var(--success)]' : 'bg-[var(--text-tertiary)]'}`} aria-hidden="true" />
            <span className="min-w-0 truncate text-sm font-medium">{item.label}</span>
            <span className="ml-auto text-xs text-[var(--text-secondary)]">{item.member?.ready ? 'Ready' : 'Getting ready'}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="text-sm leading-relaxed">{error}</p>
          {hasPendingCapture && (
            <button type="button" onClick={() => void retryUpload()} disabled={isUploading} className="min-h-11 shrink-0 rounded-lg border border-[var(--error)]/60 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--error)]">
              Retry My Upload
            </button>
          )}
        </div>
      )}

      {uiState === 'recoverable_failure' ? (
        <button type="button" onClick={() => void restartMoment()} disabled={isMutating || !bothCamerasConnected} className="min-h-12 rounded-lg bg-[var(--secondary)] px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--secondary)]">
          {isMutating ? 'Scheduling…' : isMissingOnlyRecovery ? 'Recapture My Missing Photo' : 'Restart This Moment Together'}
        </button>
      ) : captureState?.phase !== 'completed' && !captureState?.currentAttempt ? (
        <button type="button" onClick={() => void toggleReady()} disabled={isMutating || (!bothCamerasConnected && !ownMember?.ready)} className={`min-h-12 rounded-lg px-6 py-3 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 ${ownMember?.ready ? 'border border-[var(--border-active)] text-[var(--text-primary)] focus-visible:outline-[var(--primary)]' : 'bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] text-white focus-visible:outline-[var(--primary)]'}`}>
          {isMutating ? 'Updating…' : ownMember?.ready && partnerMember?.ready ? 'Resume Together' : ownMember?.ready ? 'I Need a Moment' : partnerMember?.ready ? 'Join Them—Ready' : 'I’m Ready'}
        </button>
      ) : null}

      {latestCompletedMoment?.attempt && (
        <div className="border-t border-[var(--border)] pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-semibold">Latest pair</h3>
            <span className="text-xs text-[var(--text-secondary)]">Moment {latestCompletedMoment.captureIndex}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {latestCompletedMoment.attempt.photos.map((photo) => (
              <div key={photo.position} className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[var(--canvas)]">
                {photo.previewUrl ? (
                  // Signed private URLs are short-lived and intentionally bypass image optimization.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.previewUrl} alt={`Participant ${photo.position}, moment ${latestCompletedMoment.captureIndex}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">Photo secured</div>
                )}
                <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">Participant {photo.position}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {captureState?.phase === 'completed' && (
        <div className="border-y border-[var(--success)]/35 py-6 text-center" role="status">
          <h3 className="text-xl font-semibold">Six moments, one shared session</h3>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Both participants’ twelve private photos were verified. The classic four-photo editor remains separate.</p>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {webrtc.error && webrtc.error.code !== 'access_lost' && (
          <button type="button" onClick={webrtc.reconnect} className="min-h-11 rounded-lg border border-[var(--border-active)] px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
            {webrtc.error.code === 'another_tab' ? 'Use This Tab' : 'Reconnect Cameras'}
          </button>
        )}
        <button type="button" onClick={camera.stopCamera} className="min-h-11 px-4 text-sm text-[var(--text-secondary)] underline underline-offset-4 hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
          Stop Sharing Camera
        </button>
      </div>
    </section>
  )
}
