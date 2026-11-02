'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'error'

export interface CameraError {
  type:
    | 'permission_denied'
    | 'not_found'
    | 'not_supported'
    | 'hardware_error'
    | 'constraints_error'
    | 'security_error'
    | 'aborted'
    | 'unknown'
  message: string
}

export interface UseCameraReturn {
  status: CameraStatus
  error: CameraError | null
  stream: MediaStream | null
  videoRef: RefObject<HTMLVideoElement | null>
  streamRef: RefObject<MediaStream | null>
  startCamera: () => Promise<void>
  stopCamera: () => void
}

function getCameraError(error: unknown): {
  status: Exclude<CameraStatus, 'idle' | 'requesting' | 'active'>
  error: CameraError
} {
  if (error instanceof DOMException || error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return {
        status: 'denied',
        error: {
          type: 'permission_denied',
          message:
            'Camera access was blocked. Allow camera access in your browser settings, then try again.',
        },
      }
    }

    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return {
        status: 'unavailable',
        error: {
          type: 'not_found',
          message:
            'No camera was found. Connect a camera or check that it is enabled, then try again.',
        },
      }
    }

    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return {
        status: 'error',
        error: {
          type: 'hardware_error',
          message:
            'Your camera could not start. Close other apps using it, reconnect the device, and try again.',
        },
      }
    }

    if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
      return {
        status: 'error',
        error: {
          type: 'constraints_error',
          message:
            'This camera cannot provide a compatible video stream. Try another camera or browser.',
        },
      }
    }

    if (error.name === 'SecurityError') {
      return {
        status: 'unavailable',
        error: {
          type: 'security_error',
          message:
            'Camera access requires a secure HTTPS page, except on localhost.',
        },
      }
    }

    if (error.name === 'AbortError') {
      return {
        status: 'error',
        error: {
          type: 'aborted',
          message: 'Camera startup was interrupted. Please try again.',
        },
      }
    }

    if (error.message === 'CAMERA_NOT_SUPPORTED') {
      return {
        status: 'unavailable',
        error: {
          type: 'not_supported',
          message: 'This browser does not support camera access.',
        },
      }
    }
  }

  return {
    status: 'error',
    error: {
      type: 'unknown',
      message: 'The camera could not start. Check the device and try again.',
    },
  }
}

/**
 * Owns the room's single local camera stream. Permission is requested only from
 * the explicit `startCamera` action; concurrent starts share one request.
 */
export function useCamera(): UseCameraReturn {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<CameraError | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const requestIdRef = useRef(0)
  const requestPromiseRef = useRef<Promise<void> | null>(null)
  const removeTrackListenersRef = useRef<(() => void) | null>(null)

  const releaseCurrentStream = useCallback(() => {
    removeTrackListenersRef.current?.()
    removeTrackListenersRef.current = null

    const current = streamRef.current
    if (current) current.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)

    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || status !== 'active' || !stream) return

    video.srcObject = stream
    void video.play().catch(() => {
      // The preview is muted and normally autoplays. If a browser still blocks
      // it, the stream remains valid and a later user interaction can resume it.
    })

    return () => {
      if (video.srcObject === stream) video.srcObject = null
    }
  }, [status, stream])

  const startCamera = useCallback(() => {
    const liveStream = streamRef.current
    if (
      liveStream?.getVideoTracks().some((track) => track.readyState === 'live')
    ) {
      return Promise.resolve()
    }

    if (requestPromiseRef.current) return requestPromiseRef.current

    const requestId = ++requestIdRef.current
    setError(null)
    setStatus('requesting')
    releaseCurrentStream()

    const request = (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('CAMERA_NOT_SUPPORTED')
        }

        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })

        if (requestId !== requestIdRef.current) {
          nextStream.getTracks().forEach((track) => track.stop())
          return
        }

        const videoTracks = nextStream.getVideoTracks()
        if (
          videoTracks.length === 0 ||
          !videoTracks.some((track) => track.readyState === 'live')
        ) {
          nextStream.getTracks().forEach((track) => track.stop())
          throw new DOMException('Camera track did not start', 'NotReadableError')
        }

        const handleTrackEnded = () => {
          if (streamRef.current !== nextStream) return
          removeTrackListenersRef.current?.()
          removeTrackListenersRef.current = null
          nextStream.getTracks().forEach((track) => track.stop())
          if (videoRef.current?.srcObject === nextStream) videoRef.current.srcObject = null
          streamRef.current = null
          setStream(null)
          setError({
            type: 'hardware_error',
            message:
              'The camera stopped unexpectedly. Check the device, then restart your camera.',
          })
          setStatus('error')
        }

        videoTracks.forEach((track) =>
          track.addEventListener('ended', handleTrackEnded)
        )
        removeTrackListenersRef.current = () => {
          videoTracks.forEach((track) =>
            track.removeEventListener('ended', handleTrackEnded)
          )
        }

        streamRef.current = nextStream
        setStream(nextStream)
        setStatus('active')
      } catch (caughtError) {
        if (requestId !== requestIdRef.current) return
        const cameraFailure = getCameraError(caughtError)
        setError(cameraFailure.error)
        setStatus(cameraFailure.status)
      }
    })()

    requestPromiseRef.current = request
    void request.finally(() => {
      if (requestPromiseRef.current === request) {
        requestPromiseRef.current = null
      }
    })
    return request
  }, [releaseCurrentStream])

  const stopCamera = useCallback(() => {
    requestIdRef.current += 1
    // getUserMedia prompts cannot be aborted. Keep the in-flight promise as the
    // deduplication lock; a late stream is released by the request ID check.
    releaseCurrentStream()
    setStatus('idle')
    setError(null)
  }, [releaseCurrentStream])

  useEffect(() => {
    const stopOnPageHide = () => stopCamera()
    window.addEventListener('pagehide', stopOnPageHide)
    return () => {
      window.removeEventListener('pagehide', stopOnPageHide)
      requestIdRef.current += 1
      removeTrackListenersRef.current?.()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [stopCamera])

  return {
    status,
    error,
    stream,
    videoRef,
    streamRef,
    startCamera,
    stopCamera,
  }
}
