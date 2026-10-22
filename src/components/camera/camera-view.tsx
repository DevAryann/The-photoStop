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
  const { setPhotos: setContextPhotos, photos: contextPhotos } = usePhotoStrip()
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle')
  const [countdown, setCountdown] = useState<number>(3)

  // Canvas ref for capturing frames
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Timer ref for cleanup
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Debug logging for render cycles
  console.log('[CameraView] Render - status:', status, 'photos:', photos.length, 'phase:', capturePhase)

  /**
   * Capture a single photo and add to photos array
   */
  const captureSinglePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !streamRef.current) {
      console.error('[Camera] Capture failed: missing video, canvas, or stream ref')
      return
    }

    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      const stream = streamRef.current

      console.log('[Camera] Capturing photo')

      // Verify stream has active video tracks
      const videoTracks = stream.getVideoTracks()
      if (videoTracks.length === 0 || !videoTracks.some((t) => t.readyState === 'live')) {
        throw new Error('Camera stream is not active. Please restart the camera.')
      }

      // Verify video is ready
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        throw new Error('Video is not ready yet. Please wait a moment and try again.')
      }

      // Verify video has valid dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error('Video dimensions are invalid. Please restart the camera.')
      }

      // Set canvas dimensions to match video
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      // Draw current video frame to canvas
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Failed to get canvas context')
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      // Convert canvas to Blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) {
              resolve(result)
            } else {
              reject(new Error('Failed to create blob'))
            }
          },
          'image/jpeg',
          0.92
        )
      })

      // Create object URL for preview
      const objectUrl = URL.createObjectURL(blob)

      // Add to photos array
      setPhotos((prev) => [...prev, { blob, objectUrl }])

      console.log('[Camera] Photo captured successfully, blob size:', blob.size)
    } catch (err) {
      console.error('[Camera] Error capturing photo:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to capture photo. Please try again.'
      alert(errorMessage)
      // Reset to idle on error
      setCapturePhase('idle')
    }
  }, [videoRef, streamRef])

  /**
   * Start 4-photo capture sequence
   */
  const startCaptureSequence = useCallback(async () => {
    if (capturePhase !== 'idle') return

    console.log('[Camera] Starting 4-photo capture sequence')
    setPhotos([]) // Clear any existing photos

    // Capture 4 photos with countdown and pause between each
    for (let i = 0; i < 4; i++) {
      // Countdown phase (3 seconds)
      setCapturePhase('countdown')
      for (let count = 3; count > 0; count--) {
        setCountdown(count)
        await new Promise((resolve) => {
          timerRef.current = setTimeout(resolve, 1000)
        })
      }

      // Capture phase
      setCapturePhase('capturing')
      await captureSinglePhoto()

      // Pause phase (2 seconds) - except after last photo
      if (i < 3) {
        setCapturePhase('pause')
        await new Promise((resolve) => {
          timerRef.current = setTimeout(resolve, 2000)
        })
      }
    }

    // All photos captured
    setCapturePhase('complete')
    console.log('[Camera] All 4 photos captured')
  }, [capturePhase, captureSinglePhoto])

  /**
   * Retake all photos: discard all and restart camera
   */
  const handleRetakeAll = useCallback(() => {
    // Revoke all object URLs to free memory
    photos.forEach((photo) => {
      URL.revokeObjectURL(photo.objectUrl)
    })
    setPhotos([])
    setCapturePhase('idle')

    // Restart camera
    startCamera()
  }, [photos, startCamera])

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

  /**
   * Go back from review screen: keep photos in context, return to camera
   */
  const handleBackFromReview = useCallback(() => {
    console.log('[Camera] Going back from review to camera')
    setPhotos([])
    setCapturePhase('idle')
    startCamera()
    if (onBackToCamera) {
      onBackToCamera()
    }
  }, [startCamera, onBackToCamera])

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
  if (photosToReview.length === 4 && !onReviewOpen) {
    // Only show inline review if onReviewOpen is NOT provided (we're already in review mode)
    console.log('[CameraView] Rendering 4-photo review grid')
    return (
      <div className="w-full flex flex-col items-center gap-6">
        {/* 4-Photo Grid */}
        <div className="w-full grid grid-cols-2 gap-3">
          {photosToReview.map((photo, index) => (
            <div
              key={photo.objectUrl}
              className="aspect-[4/3] rounded-lg overflow-hidden bg-[var(--canvas)] border border-[var(--border)]"
            >
              <img
                src={photo.objectUrl}
                alt={`Captured photo ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>

        {/* Photo Counter */}
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
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
          <span>All 4 photos captured</span>
        </div>

        {/* Action Buttons */}
        <div className="w-full flex gap-3">
          <button
            onClick={handleRetakeAll}
            className="flex-1 px-6 py-3 rounded-lg border border-[var(--border-active)] text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors font-medium"
          >
            Retake All
          </button>
          <button
            onClick={handleContinueToEditor}
            className="flex-1 px-6 py-3 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] text-white font-semibold hover:opacity-90 transition-opacity"
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
            <div>
              <p className="text-sm text-[var(--text-secondary)]">
                Ready to capture your first photo
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={startCamera}
          className="px-8 py-3 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] text-white font-semibold hover:opacity-90 transition-opacity"
        >
          Start Camera
        </button>
      </div>
    )
  }

  // Requesting camera permission
  if (status === 'requesting') {
    return (
      <div className="w-full flex flex-col items-center gap-6">
        <div className="w-full aspect-[4/3] rounded-xl bg-[var(--canvas)] border border-[var(--border)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[var(--text-secondary)]">Requesting camera access...</p>
          </div>
        </div>
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

        <button
          onClick={startCamera}
          className="px-6 py-2 rounded-lg border border-[var(--border-active)] text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  // Active camera: show live preview with capture sequence UI
  return (
    <div className="w-full flex flex-col items-center gap-6">
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
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="text-[120px] font-bold text-white drop-shadow-lg animate-pulse">
              {countdown}
            </div>
          </div>
        )}

        {/* Capturing Flash Effect */}
        {capturePhase === 'capturing' && (
          <div className="absolute inset-0 bg-white animate-[flash_0.3s_ease-out]" />
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
              onClick={startCaptureSequence}
              className="pointer-events-auto px-8 py-4 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] hover:scale-105 active:scale-95 transition-transform shadow-lg font-semibold text-white"
              aria-label="Start 4-photo capture"
            >
              Capture 4 Photos
            </button>
          </div>
        )}

        {/* Photo Counter During Capture */}
        {capturePhase !== 'idle' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-sm">
            <p className="text-white text-sm font-medium">
              Photo {photos.length} of 4
            </p>
          </div>
        )}
      </div>

      {/* Hidden canvas for capturing frames */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Stop Camera Button - Only when idle */}
      {capturePhase === 'idle' && (
        <button
          onClick={stopCamera}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors underline underline-offset-4"
        >
          Stop Camera
        </button>
      )}

      {/* Capture in Progress Message */}
      {capturePhase !== 'idle' && (
        <div className="text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            Capture in progress... Please stay still
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
