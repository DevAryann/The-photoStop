'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoomRealtime } from '@/hooks/use-room-realtime'
import { useSharedRoomPhotos } from '@/hooks/use-shared-room-photos'
import { CameraView } from '@/components/camera/camera-view'
import { PhotoStripEditor } from '@/components/editor/photo-strip-editor'
import {
  PhotoStripProvider,
  usePhotoStrip,
  type CapturedPhoto,
} from '@/context/photo-strip-context'
import type {
  RoomActivity,
  RoomPresenceIdentity,
  RoomPresenceKey,
  RoomState,
} from '@/lib/room-presence'
import { getParticipantDisplayName } from '@/lib/room-presence'
import { SharedPhotoStrip } from '@/components/room/shared-photo-strip'

interface RoomClientProps {
  code: string
  initialState: RoomState
  participant: RoomPresenceIdentity
  hostKey: RoomPresenceKey
  isHost: boolean
}

const ACTIVITY_DETAILS: Record<
  RoomActivity,
  { label: string; indicatorClassName: string }
> = {
  idle: {
    label: 'Idle',
    indicatorClassName: 'bg-[var(--text-secondary)]',
  },
  capturing: {
    label: 'Capturing',
    indicatorClassName: 'bg-[var(--secondary)]',
  },
  reviewing: {
    label: 'Reviewing',
    indicatorClassName: 'bg-[var(--tertiary)]',
  },
  editing: {
    label: 'Editing',
    indicatorClassName: 'bg-[var(--primary)]',
  },
  sharing: {
    label: 'Sharing',
    indicatorClassName: 'bg-[var(--success)]',
  },
}

/**
 * Client-side room UI with real-time state updates
 *
 * Subscribes to Realtime broadcast channel to detect when second participant joins.
 * Server publishes state change after successful join_room() execution.
 *
 * V1 Camera Integration:
 * - Shows camera UI only when room is active
 * - Camera permission requested only after explicit user action
 * - Maintains existing room authorization model
 *
 * Security:
 * - Capability validation happens server-side (parent Server Component)
 * - This component only handles UI updates based on broadcast events
 * - Broadcast channel is public (anyone with room code can subscribe)
 * - Broadcast contains no photo bytes or credentials, only state/invalidation IDs
 * - Room content access still requires valid capability cookie
 */
export function RoomClient({
  code,
  initialState,
  participant,
  hostKey,
  isHost,
}: RoomClientProps) {
  return (
    <PhotoStripProvider>
      <RoomSession
        code={code}
        initialState={initialState}
        participant={participant}
        hostKey={hostKey}
        isHost={isHost}
      />
    </PhotoStripProvider>
  )
}

function RoomSession({
  code,
  initialState,
  participant,
  hostKey,
  isHost,
}: RoomClientProps) {
  const {
    roomState,
    participants,
    presenceStatus,
    retryPresence,
    setActivity,
    photoSetSignal,
    subscriptionVersion,
    markRoomEnded,
  } = useRoomRealtime(code, initialState, participant, hostKey)
  const isEnded = roomState === 'ended'
  const {
    latestPhotoSet,
    loadStatus,
    loadError,
    publicationStatus,
    publicationError,
    publishPhotos,
    retryPublication,
    retryLoad,
  } = useSharedRoomPhotos(code, photoSetSignal, subscriptionVersion, isEnded)
  const { photos: contextPhotos, replacePhotos, clearPhotos } = usePhotoStrip()
  const isWaiting = roomState === 'waiting'
  const isActive = roomState === 'active'
  const onlineCount = participants.length

  // Local state for view mode: 'camera' (idle/capturing), 'review' (4 photos), 'editor'
  const [viewMode, setViewMode] = useState<'camera' | 'review' | 'editor'>('camera')
  const [isCapturing, setIsCapturing] = useState(false)
  const [appliedPhotoSetId, setAppliedPhotoSetId] = useState<string | null>(null)
  const [isEndDialogOpen, setIsEndDialogOpen] = useState(false)
  const [isEndingRoom, setIsEndingRoom] = useState(false)
  const [endRoomError, setEndRoomError] = useState<string | null>(null)
  const endDialogRef = useRef<HTMLDialogElement>(null)

  const activity: RoomActivity =
    publicationStatus === 'uploading'
      ? 'sharing'
      : isCapturing
        ? 'capturing'
        : viewMode === 'review'
          ? 'reviewing'
          : viewMode === 'editor'
            ? 'editing'
            : 'idle'

  useEffect(() => {
    setActivity(activity)
  }, [activity, setActivity])

  useEffect(() => {
    if (!isEnded) return
    clearPhotos()
  }, [clearPhotos, isEnded])

  useEffect(() => {
    if (!isEndDialogOpen) return
    const dialog = endDialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [isEndDialogOpen])

  const handleEndRoom = useCallback(async () => {
    if (!isHost || isEndingRoom) return

    setIsEndingRoom(true)
    setEndRoomError(null)
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(code)}/end`,
        { method: 'POST' }
      )
      const body = await response.json().catch(() => null) as
        | { state?: unknown; error?: string }
        | null

      if (!response.ok || body?.state !== 'ended') {
        throw new Error(
          body?.error ?? 'The room could not be ended. Please try again.'
        )
      }

      markRoomEnded()
      setIsEndDialogOpen(false)
    } catch (error) {
      setEndRoomError(
        error instanceof Error
          ? error.message
          : 'The room could not be ended. Please try again.'
      )
    } finally {
      setIsEndingRoom(false)
    }
  }, [code, isEndingRoom, isHost, markRoomEnded])

  const handlePhotosReady = useCallback(
    (photos: CapturedPhoto[], publicationId: string) => {
      void publishPhotos(photos, publicationId).then((photoSetId) => {
        if (photoSetId) setAppliedPhotoSetId(photoSetId)
      })
    },
    [publishPhotos]
  )

  const handleRetryPublication = useCallback(() => {
    void retryPublication().then((photoSetId) => {
      if (photoSetId) setAppliedPhotoSetId(photoSetId)
    })
  }, [retryPublication])

  const handleOpenSharedStrip = useCallback(() => {
    if (!latestPhotoSet) return

    if (
      contextPhotos.length === 4 &&
      !window.confirm(
        'Open the shared strip? This replaces the photos and edits currently open on this device.'
      )
    ) {
      return
    }

    const localCopies = latestPhotoSet.photos.map((photo) => ({
      blob: photo.blob,
      objectUrl: URL.createObjectURL(photo.blob),
    }))
    replacePhotos(localCopies, true)
    setAppliedPhotoSetId(latestPhotoSet.id)
    setViewMode('review')
  }, [contextPhotos.length, latestPhotoSet, replacePhotos])

  const handleBackToCamera = useCallback(() => {
    setAppliedPhotoSetId(null)
    setViewMode('camera')
  }, [])

  const knownParticipantKeys: RoomPresenceKey[] = isActive
    ? ['participant-1', 'participant-2']
    : [participant.key]
  const roomParticipants = knownParticipantKeys.map((key) => {
    const onlineParticipant = participants.find((candidate) => candidate.key === key)
    return {
      key,
      displayName: getParticipantDisplayName(key),
      isCurrentUser: key === participant.key,
      isHost: key === hostKey,
      isOnline: Boolean(onlineParticipant),
      activity: onlineParticipant?.activity ?? ('idle' as RoomActivity),
    }
  })

  if (isEnded) {
    return (
      <section
        className="flex w-full flex-col items-center gap-8 py-6 text-center"
        aria-labelledby="room-ended-title"
        aria-live="assertive"
      >
        <div className="flex size-16 items-center justify-center rounded-full border border-[var(--border-active)] bg-[var(--surface)] text-[var(--secondary)]">
          <svg
            width="30"
            height="30"
            viewBox="0 0 30 30"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M8 8L22 22M22 8L8 22"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="flex max-w-sm flex-col gap-3">
          <h1 id="room-ended-title" className="text-2xl font-bold text-[var(--text-primary)]">
            Room ended
          </h1>
          <p className="leading-relaxed text-[var(--text-secondary)]">
            {isHost
              ? 'You ended this photobooth session. Photos can no longer be captured, shared, retaken, or edited.'
              : 'The host ended this photobooth session. Photos can no longer be captured, shared, retaken, or edited.'}
          </p>
        </div>
        <Link
          href="/"
          className="min-h-11 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          Create a new room
        </Link>
      </section>
    )
  }

  return (
    <>
        {/* Room Status - Only show when camera view is active */}
        {viewMode === 'camera' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] flex items-center justify-center">
              {isWaiting ? (
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 32 32"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="animate-spin"
                >
                  <path
                    d="M16 4V8M16 24V28M8 16H4M28 16H24M22.364 22.364L19.536 19.536M22.364 9.636L19.536 12.464M9.636 22.364L12.464 19.536M9.636 9.636L12.464 12.464"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 32 32"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M9 16L14 21L23 11"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold">
                {isWaiting ? 'Waiting for Participant' : 'Room Active'}
              </h1>
              <p className="text-[var(--text-secondary)]">
                {isWaiting
                  ? 'Share the room code to invite someone'
                  : onlineCount === 2
                    ? 'Both participants are online'
                    : 'The room stays open while they reconnect'}
              </p>
            </div>
          </div>
        )}

        <section
          aria-labelledby="room-participants-heading"
          className="w-full flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-4">
            <h2
              id="room-participants-heading"
              className="text-sm font-semibold text-[var(--text-primary)]"
            >
              In this room
            </h2>
            <span
              className="text-xs text-[var(--text-secondary)] tabular-nums"
              aria-live="polite"
            >
              {presenceStatus === 'connected'
                ? `${onlineCount} online`
                : presenceStatus === 'connecting'
                  ? 'Connecting…'
                  : presenceStatus === 'reconnecting'
                    ? 'Reconnecting…'
                    : 'Presence unavailable'}
            </span>
          </div>

          <ul
            className="flex flex-wrap gap-2"
            aria-label="Room participants and their current activity"
            aria-live="polite"
          >
              {roomParticipants.map((onlineParticipant) => {
                const activityDetails = ACTIVITY_DETAILS[onlineParticipant.activity]

                return (
                  <li
                    key={onlineParticipant.key}
                    aria-label={`${onlineParticipant.displayName}${onlineParticipant.isHost ? ', host' : ''}${onlineParticipant.isCurrentUser ? ', you' : ''}: ${onlineParticipant.isOnline ? `online, ${activityDetails.label}` : 'offline'}`}
                    className="flex max-w-full min-w-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1.5 pr-3 pl-1.5"
                  >
                    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--canvas)] text-xs font-semibold text-[var(--text-primary)]">
                      {onlineParticipant.key === 'participant-1' ? '1' : '2'}
                      <span
                        className={`absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] ${onlineParticipant.isOnline ? 'bg-[var(--success)]' : 'bg-[var(--text-tertiary)]'}`}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm text-[var(--text-primary)]">
                        {onlineParticipant.displayName}
                        {onlineParticipant.isCurrentUser && (
                          <span className="text-[var(--text-secondary)]"> (You)</span>
                        )}
                      </span>
                      {onlineParticipant.isHost && (
                        <span className="shrink-0 rounded-full border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--warning)]">
                          Host
                        </span>
                      )}
                      <span
                        className="flex shrink-0 items-center gap-1 text-xs text-[var(--text-secondary)]"
                        aria-hidden="true"
                      >
                        {onlineParticipant.isOnline ? (
                          <>
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${activityDetails.indicatorClassName}`}
                            />
                            {activityDetails.label}
                          </>
                        ) : (
                          'Offline'
                        )}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>

          {presenceStatus === 'connected' && participants.length === 0 && (
            <p className="text-sm text-[var(--text-secondary)]" aria-live="polite">
              Syncing participants…
            </p>
          )}

          {presenceStatus === 'error' && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
              role="status"
            >
              <p className="text-sm text-[var(--text-secondary)]">
                Live presence could not connect.
              </p>
              <button
                type="button"
                onClick={retryPresence}
                className="min-h-11 rounded-md border border-[var(--border-active)] px-4 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                Retry
              </button>
            </div>
          )}

          {isHost && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
              <p className="min-w-0 flex-1 text-sm text-[var(--text-secondary)]">
                You created this room and can end it for everyone.
              </p>
              <button
                type="button"
                onClick={() => {
                  setEndRoomError(null)
                  setIsEndDialogOpen(true)
                }}
                className="min-h-11 rounded-lg border border-[var(--error)]/50 px-4 py-2 text-sm font-semibold text-[var(--error)] transition-colors hover:bg-[var(--error)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--error)]"
              >
                End Room
              </button>
            </div>
          )}
        </section>

        <SharedPhotoStrip
          latestPhotoSet={latestPhotoSet}
          isApplied={latestPhotoSet?.id === appliedPhotoSetId}
          hasCurrentPhotos={contextPhotos.length === 4}
          loadStatus={loadStatus}
          loadError={loadError}
          publicationStatus={publicationStatus}
          publicationError={publicationError}
          onOpen={handleOpenSharedStrip}
          onRetryLoad={() => void retryLoad()}
          onRetryPublication={handleRetryPublication}
        />

        {/* Room Code Display - Only show when camera view is active */}
        {viewMode === 'camera' && (
          <div className="w-full flex flex-col items-center gap-3 p-6 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
              Room Code
            </span>
            <div className="text-4xl font-bold tracking-wider font-mono">
              {code}
            </div>
            <p className="text-sm text-[var(--text-secondary)] text-center">
              {isWaiting
                ? 'Share this code with a friend to start'
                : 'Ready to capture photos together'}
            </p>
          </div>
        )}

        {/* Camera View - Only shown when room is active and in camera mode */}
        {isActive && viewMode === 'camera' && (
          <div className="w-full">
            <CameraView
              onReviewOpen={() => setViewMode('review')}
              onPhotosReady={handlePhotosReady}
              onCaptureActivityChange={setIsCapturing}
            />
          </div>
        )}

        {/* Review Screen - 4 photos captured, ready to edit or retake */}
        {viewMode === 'review' && (
          <div className="w-full">
            <CameraView
              onEditorOpen={() => setViewMode('editor')}
              onBackToCamera={handleBackToCamera}
              onPhotosReady={handlePhotosReady}
              onCaptureActivityChange={setIsCapturing}
            />
          </div>
        )}

        {/* Photo Strip Editor - Only shown when in editor mode */}
        {viewMode === 'editor' && (
          <div className="w-full">
            <PhotoStripEditor
              onBack={() => setViewMode('review')}
            />
          </div>
        )}

        {/* Waiting State Indicator - Only show when camera view is active */}
        {isWaiting && viewMode === 'camera' && (
          <div className="w-full p-4 rounded-lg bg-[var(--surface)] border border-[var(--border-active)]">
            <p className="text-sm text-[var(--text-secondary)] text-center">
              <span className="font-semibold text-[var(--text-primary)]">
                Waiting...
              </span>{' '}
              The session will start when a second participant joins
            </p>
          </div>
        )}

        {/* Back to Home - Only show when camera view is active */}
        {viewMode === 'camera' && (
          <Link
            href="/"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors underline underline-offset-4"
          >
            ← Back to home
          </Link>
        )}

        {isEndDialogOpen && (
          <dialog
            ref={endDialogRef}
            aria-labelledby="end-room-title"
            aria-describedby="end-room-description"
            onCancel={(event) => {
              event.preventDefault()
              if (!isEndingRoom) setIsEndDialogOpen(false)
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget && !isEndingRoom) {
                setIsEndDialogOpen(false)
              }
            }}
            className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-[var(--border-active)] bg-[var(--surface)] p-0 text-[var(--text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop:bg-black/80 backdrop:backdrop-blur-sm"
          >
            <div className="flex flex-col gap-6 p-6" aria-busy={isEndingRoom}>
              <div className="flex items-start gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--error)]/10 text-[var(--error)]">
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                    <path d="M6 6L16 16M16 6L6 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h2 id="end-room-title" className="text-xl font-semibold">
                    End this room?
                  </h2>
                  <p id="end-room-description" className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                    This ends the session for everyone. No one will be able to capture, upload, retake, or edit photos in this room.
                  </p>
                </div>
              </div>

              {endRoomError && (
                <p
                  className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm leading-relaxed text-[var(--text-primary)]"
                  role="alert"
                >
                  {endRoomError}
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setIsEndDialogOpen(false)}
                  disabled={isEndingRoom}
                  className="min-h-11 rounded-lg border border-[var(--border-active)] px-5 py-2.5 font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--canvas)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                >
                  Keep Room Open
                </button>
                <button
                  type="button"
                  onClick={() => void handleEndRoom()}
                  disabled={isEndingRoom}
                  className="min-h-11 rounded-lg bg-[var(--error)] px-5 py-2.5 font-semibold text-[#210406] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--error)]"
                >
                  {isEndingRoom ? 'Ending Room…' : 'End Room for Everyone'}
                </button>
              </div>
            </div>
          </dialog>
        )}
    </>
  )
}
