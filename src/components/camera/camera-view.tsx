'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useCamera } from '@/hooks/use-camera'
import { usePhotoStrip } from '@/context/photo-strip-context'

/**
 * Camera View Component
 *
 * V2 Scope:
 * - Request camera permission on user action
 * - Show live camera preview
 * - Capture 4 photos in sequence
 * - 3-second countdown before each capture
 * - 2-second pause between captures
 * - Show all 4 photos after completion
 * - Retake All or Continue to Editor
 *
 * NOT in V2:
 * - Device switching (front/back camera)
 * - Filters, stickers, effects
 * - Upload or storage
 * - Photo strip layout/editing
 */

interface CapturedPhoto {
  blob: Blob
  objectUrl: string
}

type CapturePhase = 'idle' | 'countdown' | 'capturing' | 'pause' | 'complete'

interface CameraViewProps {
  onReviewOpen?: () => void
  onEditorOpen?: () => void
  onBackToCamera?: () => void
}

export function CameraView({ onReviewOpen, onEditorOpen, onBackToCamera }: CameraViewProps = {}) {
  const { status, error, videoRef, streamRef, startCamera, stopCamera } = useCamera()
  const { setPhotos: setContextPhotos, photos: contextPhotos, clearPhotos: clearContextPhotos } = usePhotoStrip()
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle')
  const [countdown, setCountdown] = useState<number>(3)
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [reviewMessage, setReviewMessage] = useState<string | null>(null)

  // Canvas ref for capturing frames
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Capture run and timer refs make countdown cancellation safe.
  const captureRunRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingWaitResolveRef = useRef<(() => void) | null>(null)
  const retakeButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const focusAfterRetakeRef = useRef<number | null>(null)

  // Debug logging for render cycles
  console.log('[CameraView] Render - status:', status, 'photos:', photos.length, 'phase:', capturePhase)

  const cancelPendingWait = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const resolve = pendingWaitResolveRef.current
    pendingWaitResolveRef.current = null
    resolve?.()
  }, [])

  const wait = useCallback((duration: number) => {
    return new Promise<void>((resolve) => {
      pendingWaitResolveRef.current = resolve
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        pendingWaitResolveRef.current = null
        resolve()
      }, duration)
    })
  }, [])

  /** Capture a frame using the same canvas path for sessions and retakes. */
  const captureSinglePhoto = useCallback(async (): Promise<CapturedPhoto> => {
    if (!videoRef.current || !canvasRef.current || !streamRef.current) {
      throw new Error('The camera is not ready. Please restart it and try again.')
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    const stream = streamRef.current

    console.log('[Camera] Capturing photo')

    // Verify stream has active video tracks
    const videoTracks = stream.getVideoTracks()
    if (videoTracks.length === 0 || !videoTracks.some((t) => t.readyState === 'live')) {
      throw new Error('The camera stopped responding. Please restart it and try again.')
    }

    // Verify video is ready
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error('The camera is still loading. Please wait a moment and try again.')
    }

    // Verify video has valid dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('The camera preview is unavailable. Please restart it and try again.')
    }

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Draw current video frame to canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Photo capture is unavailable in this browser.')
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Convert canvas to Blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result)
          } else {
            reject(new Error('The photo could not be captured. Please try again.'))
          }
        },
        'image/jpeg',
        0.92
      )
    })

    const capturedPhoto = {
      blob,
      objectUrl: URL.createObjectURL(blob),
    }

    console.log('[Camera] Photo captured successfully, blob size:', blob.size)
    return capturedPhoto
  }, [videoRef, streamRef])

  /**
   * Start 4-photo capture sequence
   */
  const startCaptureSequence = useCallback(async () => {
    if (capturePhase !== 'idle') return

    const runId = ++captureRunRef.current
    console.log('[Camera] Starting 4-photo capture sequence')
    setCaptureError(null)
    photos.forEach((photo) => URL.revokeObjectURL(photo.objectUrl))
    setPhotos([])

    try {
      // Capture 4 photos with countdown and pause between each
      for (let i = 0; i < 4; i++) {
        setCapturePhase('countdown')
        for (let count = 3; count > 0; count--) {
          setCountdown(count)
          await wait(1000)
          if (runId !== captureRunRef.current) return
        }

        setCapturePhase('capturing')
        const capturedPhoto = await captureSinglePhoto()
        if (runId !== captureRunRef.current) {
          URL.revokeObjectURL(capturedPhoto.objectUrl)
          return
        }
        setPhotos((current) => [...current, capturedPhoto])

        // Pause phase (2 seconds) - except after last photo
        if (i < 3) {
          setCapturePhase('pause')
          await wait(2000)
          if (runId !== captureRunRef.current) return
        }
      }

      setCapturePhase('complete')
      console.log('[Camera] All 4 photos captured')
    } catch (err) {
      if (runId !== captureRunRef.current) return
      console.error('[Camera] Error capturing photo:', err)
      setCaptureError(
        err instanceof Error ? err.message : 'The photo could not be captured. Please try again.'
      )
      setCapturePhase('idle')
    }
  }, [capturePhase, captureSinglePhoto, photos, wait])

  const handleRetakePhoto = useCallback(
    (index: number) => {
      if (!contextPhotos[index]) return

      setReviewMessage(null)
      setCaptureError(null)
      setCapturePhase('idle')
      setCountdown(3)
      setRetakeIndex(index)
      void startCamera()
    },
    [contextPhotos, startCamera]
  )

  const handleCancelRetake = useCallback(() => {
    captureRunRef.current += 1
    cancelPendingWait()
    focusAfterRetakeRef.current = retakeIndex
    setReviewMessage('Retake canceled. Your original photo was kept.')
    setCaptureError(null)
    setCapturePhase('idle')
    setCountdown(3)
    stopCamera()
    setRetakeIndex(null)
  }, [cancelPendingWait, retakeIndex, stopCamera])

  const startRetakeCapture = useCallback(async () => {
    if (retakeIndex === null || capturePhase !== 'idle') return

    const index = retakeIndex
    const runId = ++captureRunRef.current
    let replacement: CapturedPhoto | null = null
    setCaptureError(null)

    try {
      setCapturePhase('countdown')
      for (let count = 3; count > 0; count--) {
        setCountdown(count)
        await wait(1000)
        if (runId !== captureRunRef.current) return
      }

      setCapturePhase('capturing')
      replacement = await captureSinglePhoto()
      if (runId !== captureRunRef.current) {
        URL.revokeObjectURL(replacement.objectUrl)
        return
      }

      const original = contextPhotos[index]
      if (!original) {
        throw new Error('The selected photo is no longer available. Return to review and try again.')
      }

      const updatedPhotos = [...contextPhotos]
      updatedPhotos[index] = replacement
      setContextPhotos(updatedPhotos)
      URL.revokeObjectURL(original.objectUrl)
      replacement = null

      focusAfterRetakeRef.current = index
      setReviewMessage(`Photo ${index + 1} was replaced.`)
      setCapturePhase('idle')
      setCountdown(3)
      stopCamera()
      setRetakeIndex(null)
    } catch (err) {
      if (replacement) URL.revokeObjectURL(replacement.objectUrl)
      if (runId !== captureRunRef.current) return

      console.error('[Camera] Error retaking photo:', err)
      setCaptureError(
        err instanceof Error ? err.message : 'The replacement could not be captured. Please try again.'
      )
      setCapturePhase('idle')
    }
  }, [capturePhase, captureSinglePhoto, contextPhotos, retakeIndex, setContextPhotos, stopCamera, wait])

  /**
   * Retake all photos: discard all and restart camera
   */
  const handleRetakeAll = useCallback(() => {
    // Revoke all object URLs to free memory
    photos.forEach((photo) => {
      URL.revokeObjectURL(photo.objectUrl)
    })
    setPhotos([])
    clearContextPhotos()
    setCapturePhase('idle')

    // Review owns no camera stream; return through the existing navigation callback.
    if (onBackToCamera) {
      onBackToCamera()
    } else {
      startCamera()
    }
  }, [photos, clearContextPhotos, startCamera, onBackToCamera])

  /**
   * Continue to editor: transfer photos to context and navigate
   */
  const handleContinueToEditor = useCallback(() => {
    const photosToReview = capturePhase === 'complete' && photos.length === 4 ? photos : contextPhotos
    if (photosToReview.length !== 4) {
      console.error('[Camera] Not all photos ready')
      return
    }

    console.log('[Camera] Transferring 4 photos to editor context')

    // Transfer photos to context for editor (reuse if already in context, else use local)
    if (photos.length === 4) {
      setContextPhotos(photos)
    }

    // Reset local state
    setPhotos([])
    setCapturePhase('idle')

    // Stop camera stream
    stopCamera()

    // Notify parent to show editor
    if (onEditorOpen) {
      onEditorOpen()
    }
  }, [photos, capturePhase, contextPhotos, stopCamera, setContextPhotos, onEditorOpen])

  useEffect(() => {
    return () => {
      captureRunRef.current += 1
      cancelPendingWait()
    }
  }, [cancelPendingWait])

  useEffect(() => {
    if (retakeIndex !== null || focusAfterRetakeRef.current === null) return

    const index = focusAfterRetakeRef.current
    focusAfterRetakeRef.current = null
    retakeButtonRefs.current[index]?.focus()
  }, [retakeIndex])

  // Auto-transition to review when capture completes
  useEffect(() => {
    if (capturePhase === 'complete' && photos.length === 4 && onReviewOpen) {
      // Transfer photos to context before transitioning to review mode
      // so the review-mode instance can display them from context
      setContextPhotos(photos)
      onReviewOpen()
    }
  }, [capturePhase, photos.length, onReviewOpen, photos, setContextPhotos])

  // Review screen: show 4 photos from either local capture or context (from editor return)
  // Only render this if we're in review mode (onReviewOpen not provided) or transitioning
  const photosToReview = capturePhase === 'complete' && photos.length === 4 ? photos : contextPhotos
  if (photosToReview.length === 4 && !onReviewOpen && retakeIndex === null) {
    // Only show inline review if onReviewOpen is NOT provided (we're already in review mode)
    console.log('[CameraView] Rendering 4-photo review grid')
    return (
      <div className="w-full flex flex-col items-center gap-6">
        {/* 4-Photo Grid */}
        <div className="w-full grid grid-cols-2 gap-x-3 gap-y-4">
          {photosToReview.map((photo, index) => (
            <div
              key={photo.objectUrl}
              className="min-w-0 flex flex-col gap-2"
            >
              <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-[var(--canvas)] border border-[var(--border)]">
                {/* Captures are local Blob URLs, so Next image optimization does not apply. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.objectUrl}
                  alt={`Captured photo ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <span className="absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-xs font-medium text-white">
                  Photo {index + 1}
                </span>
              </div>
              <button
                ref={(node) => {
                  retakeButtonRefs.current[index] = node
                }}
                type="button"
                onClick={() => handleRetakePhoto(index)}
                aria-label={`Retake photo ${index + 1}`}
                className="min-h-11 w-full rounded-lg border border-[var(--border-active)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                Retake
              </button>
            </div>
          ))}
        </div>

        {/* Photo Counter */}
        <div
          className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"
          role="status"
          aria-live="polite"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M5 8L7 10L11 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{reviewMessage ?? 'All 4 photos captured'}</span>
        </div>

        {/* Action Buttons */}
        <div className="w-full grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleRetakeAll}
            className="min-h-11 w-full px-6 py-3 rounded-lg border border-[var(--border-active)] text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Retake All
          </button>
          <button
            type="button"
            onClick={handleContinueToEditor}
            className="min-h-11 w-full px-6 py-3 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] text-white font-semibold hover:opacity-90 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Continue to Editor
          </button>
        </div>
      </div>
    )
  }

  // Camera not started yet
  if (status === 'idle') {
    return (
      <div className="w-full flex flex-col items-center gap-6">
        <div className="w-full aspect-[4/3] rounded-xl bg-[var(--canvas)] border border-[var(--border)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center px-6">
            <div className="w-16 h-16 rounded-full bg-[var(--surface)] flex items-center justify-center">
              <svg
                width="32"
                height="32"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="4"
                  y="8"
                  width="24"
                  height="18"
                  rx="2"
                  stroke="var(--text-secondary)"
                  strokeWidth="2"
                />
                <circle cx="16" cy="17" r="4" stroke="var(--text-secondary)" strokeWidth="2" />
                <path d="M12 8L14 4H18L20 8" stroke="var(--text-secondary)" strokeWidth="2" />
              </svg>
            </div>
            <div className="flex flex-col gap-2">
              {retakeIndex !== null && (
                <h2 className="font-semibold text-[var(--text-primary)]">
                  Retake photo {retakeIndex + 1}
                </h2>
              )}
              <p className="text-sm text-[var(--text-secondary)]">
                {retakeIndex !== null
                  ? 'Your original stays in place until a replacement is captured.'
                  : 'Ready to capture your first photo'}
              </p>
            </div>
          </div>
        </div>

        {captureError && (
          <p
            className="w-full rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--text-primary)]"
            role="alert"
          >
            {captureError}
          </p>
        )}

        <div className="flex w-full flex-col gap-3 min-[420px]:flex-row min-[420px]:justify-center">
          {retakeIndex !== null && (
            <button
              type="button"
              onClick={handleCancelRetake}
              className="min-h-11 rounded-lg border border-[var(--border-active)] px-6 py-3 font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              Back to Review
            </button>
          )}
          <button
            type="button"
            onClick={startCamera}
            className="min-h-11 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] px-8 py-3 font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Start Camera
          </button>
        </div>
      </div>
    )
  }

  // Requesting camera permission
  if (status === 'requesting') {
    return (
      <div className="w-full flex flex-col items-center gap-6">
        <div className="w-full aspect-[4/3] rounded-xl bg-[var(--canvas)] border border-[var(--border)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center px-6" role="status">
            <div className="w-12 h-12 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <div>
              <p className="font-medium text-[var(--text-primary)]">
                {retakeIndex !== null ? `Preparing photo ${retakeIndex + 1}` : 'Preparing camera'}
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Requesting camera access...</p>
            </div>
          </div>
        </div>
        {retakeIndex !== null && (
          <button
            type="button"
            onClick={handleCancelRetake}
            className="min-h-11 rounded-lg border border-[var(--border-active)] px-6 py-2 font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Cancel Retake
          </button>
        )}
      </div>
    )
  }

  // Camera permission denied or unavailable
  if (status === 'denied' || status === 'unavailable' || status === 'error') {
    return (
      <div className="w-full flex flex-col items-center gap-6">
        <div className="w-full aspect-[4/3] rounded-xl bg-[var(--canvas)] border border-[var(--border-active)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center px-6">
            <div className="w-16 h-16 rounded-full bg-[var(--surface)] border-2 border-[var(--error)] flex items-center justify-center">
              <svg
                width="32"
                height="32"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M16 10V16M16 22H16.01"
                  stroke="var(--error)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="font-semibold text-[var(--text-primary)]">
                {status === 'denied' && 'Camera Permission Denied'}
                {status === 'unavailable' && 'Camera Not Available'}
                {status === 'error' && 'Camera Error'}
              </h3>
              <p className="text-sm text-[var(--text-secondary)]">
                {error?.message || 'Unable to access camera'}
              </p>
              {status === 'denied' && (
                <p className="text-xs text-[var(--text-tertiary)] mt-2">
                  Please enable camera permissions in your browser settings
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 min-[420px]:flex-row min-[420px]:justify-center">
          {retakeIndex !== null && (
            <button
              type="button"
              onClick={handleCancelRetake}
              className="min-h-11 rounded-lg border border-[var(--border-active)] px-6 py-2 font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              Back to Review
            </button>
          )}
          <button
            type="button"
            onClick={startCamera}
            className="min-h-11 rounded-lg border border-[var(--border-active)] px-6 py-2 font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // Active camera: show live preview with capture sequence UI
  return (
    <div className="w-full flex flex-col items-center gap-6">
      {retakeIndex !== null && (
        <div className="text-center">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            Retake photo {retakeIndex + 1}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Only this photo will be replaced.
          </p>
        </div>
      )}

      {/* Video Preview */}
      <div className="w-full aspect-[4/3] rounded-xl overflow-hidden bg-black relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />

        {/* Countdown Overlay */}
        {capturePhase === 'countdown' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40" role="status" aria-live="assertive" aria-atomic="true">
            <div className="text-[clamp(5rem,24vw,7.5rem)] font-bold tabular-nums text-white drop-shadow-lg animate-pulse motion-reduce:animate-none">
              {countdown}
            </div>
          </div>
        )}

        {/* Capturing Flash Effect */}
        {capturePhase === 'capturing' && (
          <div className="absolute inset-0 bg-white animate-[flash_0.3s_ease-out] motion-reduce:animate-none" aria-hidden="true" />
        )}

        {/* Pause Indicator */}
        {capturePhase === 'pause' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin" />
              <p className="text-white text-lg font-medium">Get ready...</p>
            </div>
          </div>
        )}

        {/* Capture Button - Only shown when idle */}
        {capturePhase === 'idle' && (
          <div className="absolute inset-0 flex items-end justify-center pb-8 pointer-events-none">
            <button
              type="button"
              onClick={retakeIndex !== null ? startRetakeCapture : startCaptureSequence}
              className="pointer-events-auto min-h-11 px-8 py-4 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] hover:scale-105 active:scale-95 transition-transform motion-reduce:transform-none shadow-lg font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label={retakeIndex !== null ? `Retake photo ${retakeIndex + 1}` : 'Start 4-photo capture'}
            >
              {retakeIndex !== null ? 'Capture Replacement' : 'Capture 4 Photos'}
            </button>
          </div>
        )}

        {/* Photo Counter During Capture */}
        {capturePhase !== 'idle' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-sm">
            <p className="text-white text-sm font-medium">
              {retakeIndex !== null
                ? `Retaking photo ${retakeIndex + 1}`
                : `Photo ${Math.min(photos.length + (capturePhase === 'pause' ? 0 : 1), 4)} of 4`}
            </p>
          </div>
        )}
      </div>

      {/* Hidden canvas for capturing frames */}
      <canvas ref={canvasRef} className="hidden" />

      {captureError && (
        <p
          className="w-full rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--text-primary)]"
          role="alert"
        >
          {captureError}
        </p>
      )}

      {/* Retakes can be cancelled at any point without changing the original. */}
      {retakeIndex !== null ? (
        <button
          type="button"
          onClick={handleCancelRetake}
          className="min-h-11 px-4 text-sm text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          Cancel Retake
        </button>
      ) : capturePhase === 'idle' ? (
        <button
          type="button"
          onClick={stopCamera}
          className="min-h-11 px-4 text-sm text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          Stop Camera
        </button>
      ) : null}

      {/* Capture in Progress Message */}
      {capturePhase !== 'idle' && (
        <div className="text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            {retakeIndex !== null ? 'Capturing your replacement... Please stay still' : 'Capture in progress... Please stay still'}
          </p>
        </div>
      )}

      {/* CSS for flash animation */}
      <style jsx>{`
        @keyframes flash {
          0% {
            opacity: 0;
          }
          50% {
            opacity: 0.8;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  )
}
