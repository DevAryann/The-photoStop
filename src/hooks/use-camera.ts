'use client'

import { useRef, useCallback, useState, useEffect } from 'react'

/**
 * Camera hook for managing MediaStream access and lifecycle
 *
 * V1 Scope:
 * - Request camera permission on explicit user action
 * - Provide live video stream
 * - Properly cleanup MediaStream tracks on unmount
 *
 * Security/Privacy:
 * - Camera access only after user clicks "Start Camera"
 * - All tracks stopped on unmount or when camera is stopped
 * - No automatic background access
 */

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'error'

export interface CameraError {
  type: 'permission_denied' | 'not_found' | 'not_supported' | 'unknown'
  message: string
}

export interface UseCameraReturn {
  status: CameraStatus
  error: CameraError | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  streamRef: React.RefObject<MediaStream | null>
  startCamera: () => Promise<void>
  stopCamera: () => void
}

/**
 * Hook for camera access and stream management
 *
 * @returns Camera controls and state
 *
 * @example
 * const { status, videoRef, startCamera, stopCamera } = useCamera()
 *
 * // In component:
 * <button onClick={startCamera}>Start Camera</button>
 * <video ref={videoRef} autoPlay playsInline muted />
 */
export function useCamera(): UseCameraReturn {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<CameraError | null>(null)

  // Store MediaStream in ref to avoid re-renders
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  /**
   * Effect: Attach stream to video element when both are available
   * This runs AFTER the video element is mounted in the DOM
   */
  useEffect(() => {
    const stream = streamRef.current
    const video = videoRef.current

    if (!stream || !video) {
      return
    }

    // Diagnostic logging
    console.log('[Camera] Attaching stream to video element')
    console.log('[Camera] Stream video tracks:', stream.getVideoTracks().length)
    console.log('[Camera] Video element ready:', video.readyState)

    // Check if stream has active video tracks
    const videoTracks = stream.getVideoTracks()
    if (videoTracks.length === 0) {
      console.error('[Camera] Stream has no video tracks')
      setError({
        type: 'unknown',
        message: 'Camera stream has no video tracks',
      })
      setStatus('error')
      return
    }

    const hasActiveTrack = videoTracks.some((track) => track.readyState === 'live')
    if (!hasActiveTrack) {
      console.error('[Camera] No active video tracks in stream')
      setError({
        type: 'unknown',
        message: 'Camera stream has no active video tracks',
      })
      setStatus('error')
      return
    }

    // Attach stream to video element
    video.srcObject = stream
    console.log('[Camera] Stream attached to video.srcObject')

    // Add event listeners for diagnostics
    const handleLoadedMetadata = () => {
      console.log('[Camera] Video loadedmetadata event')
      console.log('[Camera] Video dimensions:', video.videoWidth, 'x', video.videoHeight)
      console.log('[Camera] Video readyState:', video.readyState)
    }

    const handleCanPlay = () => {
      console.log('[Camera] Video canplay event')
      console.log('[Camera] Video readyState:', video.readyState)
    }

    const handlePlaying = () => {
      console.log('[Camera] Video playing event')
      console.log('[Camera] Video dimensions:', video.videoWidth, 'x', video.videoHeight)
    }

    const handleError = (e: Event) => {
      console.error('[Camera] Video error event:', e)
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('error', handleError)

    // Explicitly start playback
    // autoPlay attribute may not be sufficient in all cases
    video
      .play()
      .then(() => {
        console.log('[Camera] Video play() promise resolved')
      })
      .catch((playError) => {
        console.error('[Camera] Video play() promise rejected:', playError)
      })

    // Cleanup: remove event listeners
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('error', handleError)
    }
  }, [status]) // Re-run when status changes (which indicates stream availability)

  /**
   * Start camera and obtain MediaStream
   */
  const startCamera = useCallback(async () => {
    // Reset error state
    setError(null)
    setStatus('requesting')

    try {
      // Check if MediaDevices API is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('NOT_SUPPORTED')
      }

      // Request camera access
      // V1: Front camera (selfie mode) at reasonable resolution
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user', // Front camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })

      console.log('[Camera] getUserMedia success')
      console.log('[Camera] Stream ID:', stream.id)
      console.log('[Camera] Video tracks:', stream.getVideoTracks().map((t) => ({
        id: t.id,
        label: t.label,
        readyState: t.readyState,
        enabled: t.enabled,
      })))

      // Store stream in ref (attachment happens in useEffect)
      streamRef.current = stream

      // Transition to active state (triggers re-render with video element)
      setStatus('active')
    } catch (err) {
      // Handle different error types
      let cameraError: CameraError

      if (err instanceof Error) {
        const errorName = (err as any).name || err.message

        if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
          cameraError = {
            type: 'permission_denied',
            message: 'Camera permission was denied',
          }
          setStatus('denied')
        } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
          cameraError = {
            type: 'not_found',
            message: 'No camera found on this device',
          }
          setStatus('unavailable')
        } else if (errorName === 'NOT_SUPPORTED') {
          cameraError = {
            type: 'not_supported',
            message: 'Camera is not supported in this browser',
          }
          setStatus('unavailable')
        } else {
          cameraError = {
            type: 'unknown',
            message: 'Failed to access camera',
          }
          setStatus('error')
        }
      } else {
        cameraError = {
          type: 'unknown',
          message: 'Failed to access camera',
        }
        setStatus('error')
      }

      setError(cameraError)
      console.error('[Camera] Error accessing camera:', err)
    }
  }, [])

  /**
   * Stop camera and release MediaStream tracks
   */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      console.log('[Camera] Stopping camera stream')
      // Stop all tracks (video and audio if any)
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    // Clear video element srcObject
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setStatus('idle')
    setError(null)
  }, [])

  /**
   * Cleanup on unmount: stop all tracks
   */
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        console.log('[Camera] Cleanup on unmount')
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  return {
    status,
    error,
    videoRef,
    streamRef,
    startCamera,
    stopCamera,
  }
}
