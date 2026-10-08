'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useCamera } from '@/hooks/use-camera'

/**
 * Camera View Component
 *
 * V1 Scope:
 * - Request camera permission on user action
 * - Show live camera preview
 * - Capture single photo (canvas-based)
 * - Show captured photo preview
 * - Retake or Keep actions
 *
 * NOT in V1:
 * - Multiple photo capture (4 photos)
 * - Device switching (front/back camera)
 * - Filters, stickers, effects
 * - Upload or storage
 */

interface CapturedPhoto {
  blob: Blob
  objectUrl: string
}

export function CameraView() {
  const { status, error, videoRef, streamRef, startCamera, stopCamera } = useCamera()
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)

  // Canvas ref for capturing frames
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Debug logging for render cycles
  console.log('[CameraView] Render - status:', status, 'capturedPhoto:', !!capturedPhoto)

  /**
   * Capture current video frame to canvas and convert to Blob
   */
  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !streamRef.current) {
      console.error('[Camera] Capture failed: missing video, canvas, or stream ref')
      return
    }

    setIsCapturing(true)

    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      const stream = streamRef.current

      console.log('[Camera] Starting capture')
      console.log('[Camera] Video readyState:', video.readyState)
      console.log('[Camera] Video dimensions:', video.videoWidth, 'x', video.videoHeight)

      // Verify stream has active video tracks
      const videoTracks = stream.getVideoTracks()
      if (videoTracks.length === 0 || !videoTracks.some((t) => t.readyState === 'live')) {
        throw new Error('Camera stream is not active. Please restart the camera.')
      }

      // Verify video is ready before attempting capture
      // readyState should be at least HAVE_CURRENT_DATA (2)
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

      // Store captured photo
      setCapturedPhoto({ blob, objectUrl })

      console.log('[Camera] Capture successful, blob size:', blob.size)
      console.log('[Camera] capturedPhoto will be set, status is:', status)

      // Don't stop camera here - keep stream active while showing preview
      // Camera will be stopped when user clicks Keep or component unmounts
    } catch (err) {
      console.error('[Camera] Error capturing photo:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to capture photo. Please try again.'
      alert(errorMessage)
    } finally {
      setIsCapturing(false)
    }
  }, [videoRef, streamRef, status])

  /**
   * Retake: discard captured photo and restart camera
   */
  const handleRetake = useCallback(() => {
    if (capturedPhoto) {
      // Revoke object URL to free memory
      URL.revokeObjectURL(capturedPhoto.objectUrl)
      setCapturedPhoto(null)
    }

    // Restart camera
    startCamera()
  }, [capturedPhoto, startCamera])

  /**
   * Keep: accept captured photo (for now, just show success)
   */
  const handleKeep = useCallback(() => {
    // V1: Just show confirmation
    // Future: Store in photo array, continue to next capture
    alert('Photo saved! (V1: No multi-photo capture yet)')

    // Clean up captured photo
    if (capturedPhoto) {
      URL.revokeObjectURL(capturedPhoto.objectUrl)
      setCapturedPhoto(null)
    }

    // Stop camera stream after keeping photo
    stopCamera()
  }, [capturedPhoto, stopCamera])

  /**
   * Cleanup object URLs on unmount
   */
  useEffect(() => {
    return () => {
      if (capturedPhoto) {
        URL.revokeObjectURL(capturedPhoto.objectUrl)
      }
    }
  }, [capturedPhoto])

  // IMPORTANT: Check capturedPhoto FIRST, before any status checks
  // This ensures the captured photo preview is shown even if status changes
  if (capturedPhoto) {
    console.log('[CameraView] Rendering captured photo preview')
    return (
      <div className="w-full flex flex-col items-center gap-6">
        <div className="w-full aspect-[4/3] rounded-xl overflow-hidden bg-[var(--canvas)] border border-[var(--border)]">
          <img
            src={capturedPhoto.objectUrl}
            alt="Captured photo"
            className="w-full h-full object-cover"
          />
        </div>

        <div className="w-full flex gap-3">
          <button
            onClick={handleRetake}
            className="flex-1 px-6 py-3 rounded-lg border border-[var(--border-active)] text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors font-medium"
          >
            Retake
          </button>
          <button
            onClick={handleKeep}
            className="flex-1 px-6 py-3 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] text-white font-semibold hover:opacity-90 transition-opacity"
          >
            Keep Photo
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

  // Active camera: show live preview with capture button
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

        {/* Capture Button Overlay */}
        <div className="absolute inset-0 flex items-end justify-center pb-8 pointer-events-none">
          <button
            onClick={capturePhoto}
            disabled={isCapturing}
            className="pointer-events-auto w-20 h-20 rounded-full bg-white border-4 border-[var(--primary)] hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 shadow-lg"
            aria-label="Capture photo"
          >
            {isCapturing ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="w-full h-full rounded-full bg-white" />
            )}
          </button>
        </div>
      </div>

      {/* Hidden canvas for capturing frames */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Stop Camera Button */}
      <button
        onClick={stopCamera}
        className="text-sm text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors underline underline-offset-4"
      >
        Stop Camera
      </button>
    </div>
  )
}
