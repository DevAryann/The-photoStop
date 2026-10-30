import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { authorizeRoomCapability } from '@/lib/room-validation'
import {
  getSharedPhotoPaths,
  isPhotoSetId,
  MAX_SHARED_PHOTO_BYTES,
  SHARED_PHOTO_BUCKET,
  SHARED_PHOTO_COUNT,
  SHARED_PHOTO_SIGNED_URL_TTL_SECONDS,
} from '@/lib/shared-photos'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ code: string }>
}

interface UploadFileDescription {
  size: number
  mimeType: string
}

const noStoreHeaders = { 'Cache-Control': 'no-store' }

function jsonNoStore(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreHeaders,
  })
}

async function getAuthorizedRequest(code: string) {
  const cookieStore = await cookies()
  const capability = cookieStore.get('session_capability')?.value
  if (!capability) return null
  return authorizeRoomCapability(code, capability)
}

function isValidUploadDescription(value: unknown): value is UploadFileDescription {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<UploadFileDescription>
  return (
    candidate.mimeType === 'image/jpeg' &&
    typeof candidate.size === 'number' &&
    Number.isInteger(candidate.size) &&
    candidate.size > 0 &&
    candidate.size <= MAX_SHARED_PHOTO_BYTES
  )
}

async function broadcastPhotoSetReady(roomCode: string, photoSetId: string) {
  const supabase = createAdminClient()
  const channel = supabase.channel(`room:${roomCode}`)

  try {
    await channel.send({
      type: 'broadcast',
      event: 'photo_set_ready',
      payload: { photoSetId },
    })
  } finally {
    await supabase.removeChannel(channel)
  }
}

async function cleanupOlderPhotoSets(
  roomId: string,
  currentPhotoSetId: string,
  readyAt: string
) {
  const supabase = createAdminClient()
  const { data: olderSets, error } = await supabase
    .from('room_photo_sets')
    .select('id, storage_paths')
    .eq('room_id', roomId)
    .eq('status', 'ready')
    .neq('id', currentPhotoSetId)
    .lt('ready_at', readyAt)

  if (error || !olderSets?.length) return

  const oldPaths = olderSets.flatMap((photoSet) => photoSet.storage_paths as string[])
  const { error: storageError } = await supabase.storage
    .from(SHARED_PHOTO_BUCKET)
    .remove(oldPaths)

  if (storageError) {
    console.error('[Shared Photos] Old object cleanup failed:', storageError)
    return
  }

  const { error: manifestError } = await supabase
    .from('room_photo_sets')
    .delete()
    .in('id', olderSets.map((photoSet) => photoSet.id))

  if (manifestError) {
    console.error('[Shared Photos] Old manifest cleanup failed:', manifestError)
  }
}

/** Return the latest ready set using short-lived, read-only signed URLs. */
export async function GET(_request: Request, context: RouteContext) {
  const { code } = await context.params
  const access = await getAuthorizedRequest(code)
  if (!access) {
    return jsonNoStore({ error: 'Room access is unavailable' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data: photoSet, error } = await supabase
    .from('room_photo_sets')
    .select('id, participant_id, storage_paths, ready_at')
    .eq('room_id', access.roomId)
    .eq('status', 'ready')
    .order('ready_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[Shared Photos] Latest set lookup failed:', error)
    return jsonNoStore({ error: 'Shared photos could not be loaded' }, { status: 503 })
  }

  if (!photoSet) return jsonNoStore({ photoSet: null })

  const storagePaths = photoSet.storage_paths as string[]
  const signedPhotos = await Promise.all(
    storagePaths.map(async (path) => {
      const { data, error: signedUrlError } = await supabase.storage
        .from(SHARED_PHOTO_BUCKET)
        .createSignedUrl(path, SHARED_PHOTO_SIGNED_URL_TTL_SECONDS)

      if (signedUrlError || !data?.signedUrl) {
        throw signedUrlError ?? new Error('Signed photo URL was not created')
      }

      return { url: data.signedUrl }
    })
  ).catch((signedUrlError: unknown) => {
    console.error('[Shared Photos] Signed URL creation failed:', signedUrlError)
    return null
  })

  if (!signedPhotos) {
    return jsonNoStore({ error: 'Shared photos could not be loaded' }, { status: 503 })
  }

  return jsonNoStore({
    photoSet: {
      id: photoSet.id,
      createdAt: photoSet.ready_at,
      isOwn: photoSet.participant_id === access.participantId,
      photos: signedPhotos,
    },
  })
}

/** Reserve opaque object paths and return narrow signed upload tokens. */
export async function POST(request: Request, context: RouteContext) {
  const { code } = await context.params
  const access = await getAuthorizedRequest(code)
  if (!access) {
    return jsonNoStore({ error: 'Room access is unavailable' }, { status: 401 })
  }

  let body: { publicationId?: unknown; files?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonNoStore({ error: 'Invalid upload request' }, { status: 400 })
  }

  if (
    !isPhotoSetId(body.publicationId) ||
    !Array.isArray(body.files) ||
    body.files.length !== SHARED_PHOTO_COUNT ||
    !body.files.every(isValidUploadDescription)
  ) {
    return jsonNoStore({ error: 'Invalid photo set' }, { status: 400 })
  }

  const publicationId = body.publicationId
  const storagePaths = getSharedPhotoPaths(publicationId)
  const supabase = createAdminClient()
  const { data: existing, error: existingError } = await supabase
    .from('room_photo_sets')
    .select('room_id, participant_id, status, storage_paths')
    .eq('id', publicationId)
    .maybeSingle()

  if (existingError) {
    console.error('[Shared Photos] Idempotency lookup failed:', existingError)
    return jsonNoStore({ error: 'Photo sharing could not start' }, { status: 503 })
  }

  if (existing) {
    if (
      existing.room_id !== access.roomId ||
      existing.participant_id !== access.participantId
    ) {
      return jsonNoStore({ error: 'Photo set is unavailable' }, { status: 409 })
    }

    if (existing.status === 'ready') {
      return jsonNoStore({ status: 'ready', photoSetId: publicationId })
    }
  } else {
    const { error: insertError } = await supabase.from('room_photo_sets').insert({
      id: publicationId,
      room_id: access.roomId,
      participant_id: access.participantId,
      status: 'uploading',
      storage_paths: storagePaths,
    })

    if (insertError) {
      console.error('[Shared Photos] Reservation failed:', insertError)
      return jsonNoStore({ error: 'Photo sharing could not start' }, { status: 503 })
    }
  }

  const uploads = await Promise.all(
    storagePaths.map(async (path) => {
      const { data, error: signedUploadError } = await supabase.storage
        .from(SHARED_PHOTO_BUCKET)
        .createSignedUploadUrl(path, { upsert: true })

      if (signedUploadError || !data?.token) {
        throw signedUploadError ?? new Error('Signed upload token was not created')
      }

      return { path, token: data.token }
    })
  ).catch((signedUploadError: unknown) => {
    console.error('[Shared Photos] Signed upload creation failed:', signedUploadError)
    return null
  })

  if (!uploads) {
    return jsonNoStore({ error: 'Photo sharing could not start' }, { status: 503 })
  }

  return jsonNoStore({ status: 'upload', photoSetId: publicationId, uploads })
}

/** Verify all four direct uploads, mark the set ready, and broadcast its ID. */
export async function PATCH(request: Request, context: RouteContext) {
  const { code } = await context.params
  const access = await getAuthorizedRequest(code)
  if (!access) {
    return jsonNoStore({ error: 'Room access is unavailable' }, { status: 401 })
  }

  let body: { publicationId?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonNoStore({ error: 'Invalid completion request' }, { status: 400 })
  }

  if (!isPhotoSetId(body.publicationId)) {
    return jsonNoStore({ error: 'Invalid photo set' }, { status: 400 })
  }

  const publicationId = body.publicationId
  const supabase = createAdminClient()
  const { data: photoSet, error: lookupError } = await supabase
    .from('room_photo_sets')
    .select('room_id, participant_id, status, storage_paths, ready_at')
    .eq('id', publicationId)
    .maybeSingle()

  if (
    lookupError ||
    !photoSet ||
    photoSet.room_id !== access.roomId ||
    photoSet.participant_id !== access.participantId
  ) {
    return jsonNoStore({ error: 'Photo set is unavailable' }, { status: 404 })
  }

  if (photoSet.status === 'ready') {
    return jsonNoStore({ status: 'ready', photoSetId: publicationId })
  }

  const expectedPaths = photoSet.storage_paths as string[]
  const prefix = `photo-sets/${publicationId}`
  const { data: uploadedObjects, error: listError } = await supabase.storage
    .from(SHARED_PHOTO_BUCKET)
    .list(prefix, { limit: SHARED_PHOTO_COUNT + 1 })

  const uploadedPaths = new Set(
    (uploadedObjects ?? []).map((object) => `${prefix}/${object.name}`)
  )

  if (listError || !expectedPaths.every((path) => uploadedPaths.has(path))) {
    return jsonNoStore(
      { error: 'Not all photos finished uploading. Please retry.' },
      { status: 409 }
    )
  }

  const readyAt = new Date().toISOString()
  const { data: completedSet, error: updateError } = await supabase
    .from('room_photo_sets')
    .update({ status: 'ready', ready_at: readyAt })
    .eq('id', publicationId)
    .eq('status', 'uploading')
    .select('ready_at')
    .maybeSingle()

  if (updateError) {
    console.error('[Shared Photos] Completion failed:', updateError)
    return jsonNoStore({ error: 'Photos uploaded but could not be shared' }, { status: 503 })
  }

  const effectiveReadyAt = completedSet?.ready_at ?? photoSet.ready_at ?? readyAt

  try {
    await broadcastPhotoSetReady(code, publicationId)
  } catch (broadcastError) {
    // The ready manifest remains authoritative. Initial load/reconnect polling
    // recovers a missed signal without uploading the images again.
    console.error('[Shared Photos] Ready broadcast failed:', broadcastError)
  }

  try {
    await cleanupOlderPhotoSets(access.roomId, publicationId, effectiveReadyAt)
  } catch (cleanupError) {
    console.error('[Shared Photos] Cleanup failed:', cleanupError)
  }

  return jsonNoStore({ status: 'ready', photoSetId: publicationId })
}
