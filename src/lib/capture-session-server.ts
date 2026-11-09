import { hashCapability } from '@/lib/capability'
import type {
  CaptureAttemptState,
  CapturePhotoState,
  CaptureSessionPosition,
  SynchronizedCaptureMomentState,
  SynchronizedCaptureState,
} from '@/lib/capture-session'
import type { AuthorizedRoomCapability } from '@/lib/room-validation'
import { SHARED_PHOTO_BUCKET } from '@/lib/shared-photos'
import { createAdminClient } from '@/lib/supabase/admin'

const CAPTURE_PREVIEW_TTL_SECONDS = 5 * 60

interface LoadCaptureStateOptions {
  roomCode: string
  capability: string
  access: AuthorizedRoomCapability
}

export async function loadSynchronizedCaptureState({
  roomCode,
  capability,
  access,
}: LoadCaptureStateOptions): Promise<SynchronizedCaptureState | null> {
  const supabase = createAdminClient()
  const { data: session, error: sessionError } = await supabase
    .from('room_capture_sessions')
    .select('id, opaque_id, phase, revision')
    .eq('room_id', access.roomId)
    .eq('is_current', true)
    .maybeSingle()

  if (sessionError || !session) {
    if (sessionError) {
      console.error('[Synchronized Capture] Session lookup failed:', sessionError)
    }
    return null
  }

  const [membersResult, momentsResult, attemptsResult] =
    await Promise.all([
      supabase
        .from('capture_session_members')
        .select('participant_id, position, is_ready, lease_expires_at, active_webrtc_client_id')
        .eq('session_id', session.id),
      supabase
        .from('capture_moments')
        .select('id, capture_index')
        .eq('session_id', session.id)
        .order('capture_index', { ascending: true }),
      supabase
        .from('capture_attempts')
        .select('id, opaque_id, moment_id, attempt_number, scheduled_capture_at, result_state, created_at, updated_at')
        .eq('session_id', session.id)
        .order('attempt_number', { ascending: false }),
    ])

  if (
    membersResult.error ||
    momentsResult.error ||
    attemptsResult.error
  ) {
    console.error('[Synchronized Capture] State lookup failed:', {
      members: membersResult.error,
      moments: momentsResult.error,
      attempts: attemptsResult.error,
    })
    return null
  }

  const members = membersResult.data ?? []
  const moments = momentsResult.data ?? []
  const attempts = attemptsResult.data ?? []
  const participantPosition = members.find(
    (member) => member.participant_id === access.participantId
  )?.position

  if (
    members.length !== 2 ||
    moments.length !== 6 ||
    (participantPosition !== 'A' && participantPosition !== 'B')
  ) {
    console.error('[Synchronized Capture] Invalid authoritative shape')
    return null
  }

  const attemptIds = attempts.map((attempt) => attempt.id)
  const { data: images, error: imageError } = attemptIds.length
    ? await supabase
        .from('capture_images')
        .select('attempt_id, participant_id, storage_path, upload_status, captured_at, retry_scheduled_at')
        .in('attempt_id', attemptIds)
    : { data: [], error: null }

  if (imageError) {
    console.error('[Synchronized Capture] Image state lookup failed:', imageError)
    return null
  }

  const positionByParticipant = new Map<string, CaptureSessionPosition>(
    members.map((member) => [
      member.participant_id,
      member.position as CaptureSessionPosition,
    ])
  )

  const previewUrls = new Map<string, string>()
  const momentIndexById = new Map(
    moments.map((moment) => [moment.id, moment.capture_index])
  )
  const latestCompleteAttempt = attempts
    .filter((attempt) => attempt.result_state === 'complete')
    .sort(
      (left, right) =>
        (momentIndexById.get(right.moment_id) ?? 0) -
        (momentIndexById.get(left.moment_id) ?? 0)
    )[0]
  await Promise.all(
    (images ?? [])
      .filter(
        (image) =>
          image.upload_status === 'verified' &&
          image.attempt_id === latestCompleteAttempt?.id
      )
      .map(async (image) => {
        const { data, error } = await supabase.storage
          .from(SHARED_PHOTO_BUCKET)
          .createSignedUrl(image.storage_path, CAPTURE_PREVIEW_TTL_SECONDS)
        if (!error && data?.signedUrl) {
          previewUrls.set(
            `${image.attempt_id}:${image.participant_id}`,
            data.signedUrl
          )
        }
      })
  )

  // Sample the database clock as late as possible so signed-URL work is not
  // incorrectly counted as network latency by the browser's midpoint estimate.
  const { data: serverTimeValue, error: serverTimeError } = await supabase.rpc(
    'get_synchronized_capture_server_time',
    {
      p_room_code: roomCode,
      p_capability_hash: hashCapability(capability),
    }
  )
  const serverTime = Date.parse(String(serverTimeValue))
  if (serverTimeError || !Number.isFinite(serverTime)) {
    console.error('[Synchronized Capture] Server clock lookup failed:', serverTimeError)
    return null
  }

  const serializeAttempt = (attempt: (typeof attempts)[number]): CaptureAttemptState => {
    const photos: CapturePhotoState[] = members
      .map((member) => {
        const image = (images ?? []).find(
          (candidate) =>
            candidate.attempt_id === attempt.id &&
            candidate.participant_id === member.participant_id
        )
        const position = positionByParticipant.get(member.participant_id)!
        const previewUrl = previewUrls.get(
          `${attempt.id}:${member.participant_id}`
        )
        return {
          position,
          status: (image?.upload_status ?? 'reserved') as CapturePhotoState['status'],
          capturedAt:
            typeof image?.captured_at === 'string' ? image.captured_at : null,
          ...(previewUrl ? { previewUrl } : {}),
        }
      })
      .sort((left, right) => left.position.localeCompare(right.position))

    const ownImage = (images ?? []).find(
      (image) =>
        image.attempt_id === attempt.id &&
        image.participant_id === access.participantId
    )

    return {
      attemptId: attempt.opaque_id,
      attemptNumber: attempt.attempt_number,
      createdAt: attempt.created_at,
      scheduledAt:
        typeof ownImage?.retry_scheduled_at === 'string'
          ? ownImage.retry_scheduled_at
          : attempt.scheduled_capture_at,
      completedAt:
        attempt.result_state === 'complete' ? attempt.updated_at : null,
      resultState: attempt.result_state as CaptureAttemptState['resultState'],
      photos,
    }
  }

  let currentAttempt: CaptureAttemptState | null = null
  let currentMoment: number | null = null
  const serializedMoments: SynchronizedCaptureMomentState[] = moments.map(
    (moment) => {
      const momentAttempts = attempts.filter(
        (attempt) => attempt.moment_id === moment.id
      )
      const completeAttempt = momentAttempts.find(
        (attempt) => attempt.result_state === 'complete'
      )
      const activeAttempt = momentAttempts.find(
        (attempt) =>
          attempt.result_state === 'pending' || attempt.result_state === 'partial'
      )
      const selectedAttempt = completeAttempt ?? activeAttempt ?? null

      if (activeAttempt) {
        currentMoment = moment.capture_index
        currentAttempt = serializeAttempt(activeAttempt)
      }

      return {
        captureIndex: moment.capture_index,
        status: completeAttempt
          ? 'complete'
          : activeAttempt
            ? 'active'
            : 'pending',
        attempt: selectedAttempt ? serializeAttempt(selectedAttempt) : null,
      }
    }
  )

  return {
    sessionId: session.opaque_id,
    phase: session.phase,
    revision: session.revision,
    participantPosition,
    serverTimeMs: serverTime,
    members: members
      .map((member) => ({
        position: member.position as CaptureSessionPosition,
        ready: member.is_ready,
        connected: Boolean(
          member.active_webrtc_client_id &&
            typeof member.lease_expires_at === 'string' &&
            Date.parse(member.lease_expires_at) > serverTime
        ),
      }))
      .sort((left, right) => left.position.localeCompare(right.position)),
    moments: serializedMoments,
    currentMoment,
    currentAttempt,
    completedMomentCount: serializedMoments.filter(
      (moment) => moment.status === 'complete'
    ).length,
  }
}

export async function broadcastCaptureState(
  roomCode: string,
  state: Pick<
    SynchronizedCaptureState,
    'sessionId' | 'revision' | 'participantPosition' | 'currentAttempt'
  >
) {
  const supabase = createAdminClient()
  const channel = supabase.channel(`room:${roomCode}`)
  try {
    await channel.send({
      type: 'broadcast',
      event: 'capture_state_changed',
      payload: {
        sessionId: state.sessionId,
        revision: state.revision,
        sourcePosition: state.participantPosition,
        attemptId: state.currentAttempt?.attemptId ?? null,
      },
    })
  } finally {
    await supabase.removeChannel(channel)
  }
}
