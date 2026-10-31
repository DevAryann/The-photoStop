'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CapturedPhoto } from '@/context/photo-strip-context'
import {
  isPhotoSetId,
  MAX_SHARED_PHOTO_BYTES,
  SHARED_PHOTO_COUNT,
  SHARED_PHOTO_BUCKET,
} from '@/lib/shared-photos'
import { createClient } from '@/lib/supabase/client'

export interface SharedRoomPhotoSet {
  id: string
  createdAt: string
  isOwn: boolean
  photos: CapturedPhoto[]
}

type LoadStatus = 'loading' | 'ready' | 'empty' | 'error'
type PublicationStatus = 'idle' | 'uploading' | 'error'

interface PendingPublication {
  id: string
  photos: CapturedPhoto[]
}

interface PhotoSetApiResponse {
  photoSet: null | {
    id: string
    createdAt: string
    isOwn: boolean
    photos: Array<{ url: string }>
  }
}

interface UploadReservationResponse {
  status: 'ready' | 'upload'
  photoSetId: string
  uploads?: Array<{ path: string; token: string }>
}

function revokePhotos(photos: CapturedPhoto[]) {
  photos.forEach((photo) => URL.revokeObjectURL(photo.objectUrl))
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null
  if (!response.ok) {
    throw new Error(body?.error ?? 'The shared photo request failed')
  }
  return body as T
}

export function useSharedRoomPhotos(
  roomCode: string,
  photoSetSignal: string | null,
  subscriptionVersion: number,
  roomEnded: boolean
) {
  const [latestPhotoSet, setLatestPhotoSet] = useState<SharedRoomPhotoSet | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [publicationStatus, setPublicationStatus] =
    useState<PublicationStatus>('idle')
  const [publicationError, setPublicationError] = useState<string | null>(null)

  const latestRef = useRef<(SharedRoomPhotoSet & { ownsObjectUrls: boolean }) | null>(null)
  const loadGenerationRef = useRef(0)
  const loadAbortRef = useRef<AbortController | null>(null)
  const pendingPublicationRef = useRef<PendingPublication | null>(null)
  const publicationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const completedPublicationIdsRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const roomEndedRef = useRef(roomEnded)

  useEffect(() => {
    roomEndedRef.current = roomEnded
  }, [roomEnded])

  const replaceLatest = useCallback(
    (next: SharedRoomPhotoSet, ownsObjectUrls: boolean) => {
      const previous = latestRef.current
      if (previous?.ownsObjectUrls && previous.id !== next.id) {
        revokePhotos(previous.photos)
      }

      latestRef.current = { ...next, ownsObjectUrls }
      setLatestPhotoSet(next)
    },
    []
  )

  const refresh = useCallback(async (preferredPhotoSetId?: string) => {
    if (roomEndedRef.current) return
    if (
      preferredPhotoSetId &&
      latestRef.current?.id === preferredPhotoSetId
    ) {
      return
    }

    const generation = ++loadGenerationRef.current
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    setLoadError(null)

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/photos`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      const body = await readJsonResponse<PhotoSetApiResponse>(response)
      if (generation !== loadGenerationRef.current || controller.signal.aborted) return

      if (!body.photoSet) {
        if (!latestRef.current) setLoadStatus('empty')
        return
      }

      const remoteSet = body.photoSet
      if (
        !isPhotoSetId(remoteSet.id) ||
        !Array.isArray(remoteSet.photos) ||
        remoteSet.photos.length !== SHARED_PHOTO_COUNT ||
        remoteSet.photos.some((photo) => typeof photo?.url !== 'string')
      ) {
        throw new Error('The shared photo response was invalid')
      }

      if (latestRef.current?.id === remoteSet.id) {
        setLoadStatus('ready')
        return
      }

      const downloadedPhotos: CapturedPhoto[] = []
      try {
        for (const photo of remoteSet.photos) {
          const photoResponse = await fetch(photo.url, { signal: controller.signal })
          if (!photoResponse.ok) throw new Error('A shared photo could not be downloaded')

          const blob = await photoResponse.blob()
          if (!blob.type.startsWith('image/') || blob.size > MAX_SHARED_PHOTO_BYTES) {
            throw new Error('A shared photo was invalid')
          }

          downloadedPhotos.push({ blob, objectUrl: URL.createObjectURL(blob) })
        }
      } catch (error) {
        revokePhotos(downloadedPhotos)
        throw error
      }

      if (generation !== loadGenerationRef.current || controller.signal.aborted) {
        revokePhotos(downloadedPhotos)
        return
      }

      replaceLatest(
        {
          id: remoteSet.id,
          createdAt: remoteSet.createdAt,
          isOwn: remoteSet.isOwn,
          photos: downloadedPhotos,
        },
        true
      )
      setLoadStatus('ready')
    } catch (error) {
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return
      setLoadStatus('error')
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Shared photos could not be loaded. Please try again.'
      )
    }
  }, [replaceLatest, roomCode])

  const performPublication = useCallback(async (publication: PendingPublication) => {
    if (completedPublicationIdsRef.current.has(publication.id)) return publication.id
    if (roomEndedRef.current) return null
    if (mountedRef.current) {
      setPublicationStatus('uploading')
      setPublicationError(null)
    }

    try {
      const reservationResponse = await fetch(
        `/api/rooms/${encodeURIComponent(roomCode)}/photos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publicationId: publication.id,
            files: publication.photos.map((photo) => ({
              size: photo.blob.size,
              mimeType: photo.blob.type || 'image/jpeg',
            })),
          }),
        }
      )
      const reservation = await readJsonResponse<UploadReservationResponse>(
        reservationResponse
      )

      if (roomEndedRef.current) {
        throw new Error('This room has ended. Photos can no longer be uploaded.')
      }

      if (reservation.status === 'upload') {
        if (
          !reservation.uploads ||
          reservation.uploads.length !== SHARED_PHOTO_COUNT
        ) {
          throw new Error('Photo upload could not start')
        }

        const supabase = createClient()
        await Promise.all(
          reservation.uploads.map(async (upload, index) => {
            if (roomEndedRef.current) {
              throw new Error('This room has ended. Photos can no longer be uploaded.')
            }
            const photo = publication.photos[index]
            const { error } = await supabase.storage
              .from(SHARED_PHOTO_BUCKET)
              .uploadToSignedUrl(upload.path, upload.token, photo.blob, {
                contentType: 'image/jpeg',
              })

            if (error) throw error
          })
        )

        if (roomEndedRef.current) {
          throw new Error('This room has ended. Photos can no longer be published.')
        }

        const completionResponse = await fetch(
          `/api/rooms/${encodeURIComponent(roomCode)}/photos`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicationId: publication.id }),
          }
        )
        await readJsonResponse<{ status: 'ready'; photoSetId: string }>(
          completionResponse
        )
      }

      completedPublicationIdsRef.current.add(publication.id)
      if (mountedRef.current) {
        const previewPhotos = publication.photos.map((photo) => ({
          blob: photo.blob,
          objectUrl: URL.createObjectURL(photo.blob),
        }))
        replaceLatest(
          {
            id: publication.id,
            createdAt: new Date().toISOString(),
            isOwn: true,
            photos: previewPhotos,
          },
          true
        )
        setPublicationStatus('idle')
        setPublicationError(null)
        setLoadStatus('ready')
      }
      return publication.id
    } catch (error) {
      if (mountedRef.current) {
        setPublicationStatus('error')
        setPublicationError(
          error instanceof Error
            ? error.message
            : 'Your photos are safe here, but they could not be shared.'
        )
      }
      return null
    }
  }, [replaceLatest, roomCode])

  const publishPhotos = useCallback(
    (photos: CapturedPhoto[], publicationId: string): Promise<string | null> => {
      if (photos.length !== SHARED_PHOTO_COUNT || !isPhotoSetId(publicationId)) {
        return Promise.resolve(null)
      }

      const publication = { id: publicationId, photos }
      pendingPublicationRef.current = publication

      const operation = publicationQueueRef.current
        .catch(() => undefined)
        .then(() => performPublication(publication))
      publicationQueueRef.current = operation.then(() => undefined)
      return operation
    },
    [performPublication]
  )

  const retryPublication = useCallback(() => {
    const pending = pendingPublicationRef.current
    if (!pending) return Promise.resolve<string | null>(null)
    return publishPhotos(pending.photos, pending.id)
  }, [publishPhotos])

  useEffect(() => {
    if (roomEnded) {
      loadGenerationRef.current += 1
      loadAbortRef.current?.abort()
      return
    }

    // Defer the network-driven state transition out of the effect body. The
    // generation guard in refresh still resolves overlapping signals safely.
    const timeoutId = window.setTimeout(() => {
      void refresh(photoSetSignal ?? undefined)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [photoSetSignal, refresh, roomEnded, subscriptionVersion])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      loadGenerationRef.current += 1
      loadAbortRef.current?.abort()
      const latest = latestRef.current
      if (latest?.ownsObjectUrls) revokePhotos(latest.photos)
    }
  }, [])

  return {
    latestPhotoSet,
    loadStatus,
    loadError,
    publicationStatus,
    publicationError,
    publishPhotos,
    retryPublication,
    retryLoad: refresh,
  }
}
