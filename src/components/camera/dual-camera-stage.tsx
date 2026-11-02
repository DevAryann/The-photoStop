'use client'

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import type {
  RoomWebRtcError,
  RoomWebRtcStatus,
} from '@/hooks/use-room-webrtc'

interface DualCameraStageProps {
  localVideoRef: RefObject<HTMLVideoElement | null>
  remoteStream: MediaStream | null
  connectionStatus: RoomWebRtcStatus
  connectionError: RoomWebRtcError | null
  localLabel: string
  remoteLabel: string
  children?: ReactNode
}

const STATUS_DETAILS: Record<
  RoomWebRtcStatus,
  { label: string; dotClassName: string }
> = {
  idle: {
    label: 'Disconnected',
    dotClassName: 'bg-[var(--text-tertiary)]',
  },
  connecting: {
    label: 'Connecting',
    dotClassName: 'bg-[var(--warning)] animate-pulse motion-reduce:animate-none',
  },
  connected: {
    label: 'Connected',
    dotClassName: 'bg-[var(--success)]',
  },
  reconnecting: {
    label: 'Reconnecting',
    dotClassName: 'bg-[var(--warning)] animate-pulse motion-reduce:animate-none',
  },
  disconnected: {
    label: 'Disconnected',
    dotClassName: 'bg-[var(--error)]',
  },
  unsupported: {
    label: 'Unavailable',
    dotClassName: 'bg-[var(--error)]',
  },
}

function getEmptyStateCopy(
  status: RoomWebRtcStatus,
  error: RoomWebRtcError | null
) {
  if (error?.code === 'another_tab') {
    return 'Camera sharing is active in another tab'
  }
  if (status === 'connecting') return 'Bringing your cameras together…'
  if (status === 'reconnecting') return 'Finding your partner again…'
  if (status === 'unsupported') return 'Live partner video is unavailable'
  if (status === 'disconnected') return 'Partner video is paused'
  return 'Your partner’s camera will appear here'
}

export function DualCameraStage({
  localVideoRef,
  remoteStream,
  connectionStatus,
  connectionError,
  localLabel,
  remoteLabel,
  children,
}: DualCameraStageProps) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const statusDetails = STATUS_DETAILS[connectionStatus]

  useEffect(() => {
    const video = remoteVideoRef.current
    if (!video) return
    video.srcObject = remoteStream
    if (remoteStream) void video.play().catch(() => undefined)
    return () => {
      if (video.srcObject === remoteStream) video.srcObject = null
    }
  }, [remoteStream])

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-[var(--border-active)] bg-[#070a0f] shadow-[0_24px_70px_-34px_rgba(255,74,125,0.45)] sm:aspect-video">
      {remoteStream ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted
          aria-label={`${remoteLabel} live camera`}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(145deg,#101722_0%,#090d14_70%)] px-8 text-center">
          <div className="flex max-w-sm flex-col items-center gap-4">
            <svg
              viewBox="0 0 48 48"
              className="size-12 text-[var(--text-tertiary)]"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="6"
                y="12"
                width="36"
                height="27"
                rx="5"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M17 12L20 7H28L31 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx="24"
                cy="25.5"
                r="7"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
            <p className="text-sm font-medium text-[var(--text-secondary)] sm:text-base">
              {getEmptyStateCopy(connectionStatus, connectionError)}
            </p>
          </div>
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/65 to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/75 to-transparent"
        aria-hidden="true"
      />

      <div className="absolute top-3 left-3 flex min-h-8 items-center gap-2 rounded-full border border-white/15 bg-black/65 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm sm:top-4 sm:left-4">
        <span
          className={`size-2 shrink-0 rounded-full ${statusDetails.dotClassName}`}
          aria-hidden="true"
        />
        <span role="status" aria-live="polite">
          {statusDetails.label}
        </span>
      </div>

      <span className="absolute bottom-3 left-3 max-w-[45%] truncate rounded bg-black/65 px-2.5 py-1.5 text-xs font-semibold text-white sm:bottom-4 sm:left-4 sm:text-sm">
        {remoteLabel}
      </span>

      <div className="absolute top-3 right-3 w-[32%] min-w-24 max-w-56 overflow-hidden rounded-lg border border-white/25 bg-black shadow-[0_12px_36px_rgba(0,0,0,0.45)] sm:top-4 sm:right-4">
        <div className="relative aspect-[4/3]">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            aria-label={`${localLabel} camera preview`}
            className="h-full w-full -scale-x-100 object-cover"
          />
          <span className="absolute right-1.5 bottom-1.5 max-w-[calc(100%-0.75rem)] truncate rounded bg-black/65 px-1.5 py-1 text-[0.625rem] font-semibold text-white sm:right-2 sm:bottom-2 sm:px-2 sm:text-xs">
            {localLabel}
          </span>
        </div>
      </div>

      {children}
    </div>
  )
}
