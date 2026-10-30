'use client'

import type { SharedRoomPhotoSet } from '@/hooks/use-shared-room-photos'

interface SharedPhotoStripProps {
  latestPhotoSet: SharedRoomPhotoSet | null
  isApplied: boolean
  hasCurrentPhotos: boolean
  loadStatus: 'loading' | 'ready' | 'empty' | 'error'
  loadError: string | null
  publicationStatus: 'idle' | 'uploading' | 'error'
  publicationError: string | null
  onOpen: () => void
  onRetryLoad: () => void
  onRetryPublication: () => void
}

export function SharedPhotoStrip({
  latestPhotoSet,
  isApplied,
  hasCurrentPhotos,
  loadStatus,
  loadError,
  publicationStatus,
  publicationError,
  onOpen,
  onRetryLoad,
  onRetryPublication,
}: SharedPhotoStripProps) {
  if (
    !latestPhotoSet &&
    loadStatus === 'empty' &&
    publicationStatus === 'idle' &&
    !publicationError
  ) {
    return null
  }

  return (
    <section
      aria-labelledby="shared-strip-heading"
      className="w-full border-y border-[var(--border)] py-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="shared-strip-heading" className="text-sm font-semibold text-[var(--text-primary)]">
            Shared photo strip
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
            {publicationStatus === 'uploading'
              ? 'Sharing your four photos with this room…'
              : latestPhotoSet && isApplied
                ? 'You’re viewing the latest photos in this room.'
                : latestPhotoSet
                  ? latestPhotoSet.isOwn
                    ? 'Your latest photos are ready to open.'
                    : 'New photos arrived from the other participant.'
                  : 'Checking this room for shared photos…'}
          </p>
        </div>
        {publicationStatus === 'uploading' && (
          <svg
            viewBox="0 0 24 24"
            className="mt-0.5 size-5 shrink-0 animate-spin text-[var(--primary)] motion-reduce:animate-none"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        )}
      </div>

      {latestPhotoSet && !isApplied && (
        <div className="mt-4">
          <div className="grid grid-cols-4 gap-2" aria-label="Latest shared photos">
            {latestPhotoSet.photos.map((photo, index) => (
              <div
                key={`${latestPhotoSet.id}-${index}`}
                className="aspect-[4/3] min-w-0 overflow-hidden rounded bg-[var(--canvas)]"
              >
                {/* Shared photos are local Blob URLs after one authorized download. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.objectUrl}
                  alt={`Shared photo ${index + 1}`}
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="mt-3 min-h-11 w-full rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] px-5 py-2.5 font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Open shared strip
          </button>
          {hasCurrentPhotos && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              Opening these photos replaces the set currently in your editor. Your current edits won’t carry over.
            </p>
          )}
        </div>
      )}

      {publicationError && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 p-3" role="alert">
          <p className="min-w-0 flex-1 text-sm text-[var(--text-primary)]">
            {publicationError} Your local photos are still safe.
          </p>
          <button
            type="button"
            onClick={onRetryPublication}
            className="min-h-11 rounded-md border border-[var(--border-active)] px-4 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Retry sharing
          </button>
        </div>
      )}

      {loadStatus === 'error' && loadError && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3" role="status">
          <p className="min-w-0 flex-1 text-sm text-[var(--text-secondary)]">
            {loadError}
          </p>
          <button
            type="button"
            onClick={onRetryLoad}
            className="min-h-11 rounded-md border border-[var(--border-active)] px-4 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Retry loading
          </button>
        </div>
      )}
    </section>
  )
}
