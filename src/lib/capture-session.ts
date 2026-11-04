export const CAPTURE_MOMENT_COUNT = 6

export const CAPTURE_SESSION_PHASES = [
  'camera_setup',
  'preparing',
  'countdown',
  'capturing',
  'completed',
  'selecting',
  'editing',
  'finalizing',
  'finalized',
] as const

export type CaptureSessionPhase = (typeof CAPTURE_SESSION_PHASES)[number]
export type CaptureSessionPosition = 'A' | 'B'

export const CAPTURE_UPLOAD_STATUSES = [
  'reserved',
  'uploading',
  'uploaded',
  'verified',
  'failed',
] as const

export type CaptureUploadStatus = (typeof CAPTURE_UPLOAD_STATUSES)[number]
export type SynchronizedCaptureUiState =
  | 'waiting_participants'
  | 'waiting_readiness'
  | 'scheduled'
  | 'countdown'
  | 'capturing'
  | 'uploading'
  | 'waiting_partner_upload'
  | 'moment_completed'
  | 'session_completed'
  | 'recoverable_failure'

export interface CaptureMemberState {
  position: CaptureSessionPosition
  ready: boolean
  connected: boolean
}

export interface CapturePhotoState {
  position: CaptureSessionPosition
  status: CaptureUploadStatus
  capturedAt: string | null
  previewUrl?: string
}

export interface CaptureAttemptState {
  attemptId: string
  attemptNumber: number
  scheduledAt: string
  resultState: 'pending' | 'partial' | 'complete'
  photos: CapturePhotoState[]
}

export interface SynchronizedCaptureMomentState {
  captureIndex: number
  status: 'pending' | 'active' | 'complete'
  attempt: CaptureAttemptState | null
}

export interface SynchronizedCaptureState {
  sessionId: string
  phase: CaptureSessionPhase
  revision: number
  participantPosition: CaptureSessionPosition
  serverTimeMs: number
  members: CaptureMemberState[]
  moments: SynchronizedCaptureMomentState[]
  currentMoment: number | null
  currentAttempt: CaptureAttemptState | null
  completedMomentCount: number
}

export interface ServerClockSample {
  clientWallSendMs: number
  clientWallReceiveMs: number
  serverTimeMs: number
}

export interface ServerClockEstimate {
  offsetMs: number
  roundTripMs: number
  sampledAtClientWallMs: number
}

/**
 * NTP-style midpoint estimation. The lowest-latency samples are least affected
 * by asymmetric request delay; weighting up to the best three reduces jitter.
 */
export function estimateServerClock(
  samples: ServerClockSample[]
): ServerClockEstimate | null {
  const valid = samples
    .filter(
      (sample) =>
        Number.isFinite(sample.clientWallSendMs) &&
        Number.isFinite(sample.clientWallReceiveMs) &&
        Number.isFinite(sample.serverTimeMs) &&
        sample.clientWallReceiveMs >= sample.clientWallSendMs
    )
    .map((sample) => {
      const roundTripMs = sample.clientWallReceiveMs - sample.clientWallSendMs
      const midpoint = sample.clientWallSendMs + roundTripMs / 2
      return {
        offsetMs: sample.serverTimeMs - midpoint,
        roundTripMs,
        sampledAtClientWallMs: sample.clientWallReceiveMs,
      }
    })
    .sort((left, right) => left.roundTripMs - right.roundTripMs)
    .slice(0, 3)

  if (valid.length === 0) return null

  let totalWeight = 0
  let weightedOffset = 0
  for (const sample of valid) {
    const weight = 1 / Math.max(1, sample.roundTripMs)
    totalWeight += weight
    weightedOffset += sample.offsetMs * weight
  }

  return {
    offsetMs: weightedOffset / totalWeight,
    roundTripMs: valid[0].roundTripMs,
    sampledAtClientWallMs: Math.max(
      ...valid.map((sample) => sample.sampledAtClientWallMs)
    ),
  }
}

/** Convert a server wall-clock deadline into this document's monotonic clock. */
export function getMonotonicCaptureDeadline(
  scheduledServerTimeMs: number,
  clock: ServerClockEstimate,
  clientWallNowMs: number,
  performanceNowMs: number
) {
  const localWallDeadline = scheduledServerTimeMs - clock.offsetMs
  return performanceNowMs + (localWallDeadline - clientWallNowMs)
}

export function shouldScheduleAttempt(
  handledAttemptId: string | null,
  attemptId: string,
  ownUploadStatus: CaptureUploadStatus
) {
  return handledAttemptId !== attemptId && ownUploadStatus !== 'verified'
}

export function isSynchronizedCaptureState(
  value: unknown
): value is SynchronizedCaptureState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<SynchronizedCaptureState>
  return (
    typeof state.sessionId === 'string' &&
    UUID_PATTERN.test(state.sessionId) &&
    isCaptureSessionPhase(state.phase) &&
    typeof state.revision === 'number' &&
    Number.isInteger(state.revision) &&
    state.revision > 0 &&
    isCaptureSessionPosition(state.participantPosition) &&
    typeof state.serverTimeMs === 'number' &&
    Number.isFinite(state.serverTimeMs) &&
    Array.isArray(state.members) &&
    state.members.length === 2 &&
    Array.isArray(state.moments) &&
    state.moments.length === CAPTURE_MOMENT_COUNT &&
    typeof state.completedMomentCount === 'number'
  )
}

export interface CaptureMomentSummary {
  captureIndex: number
}

export interface AuthoritativeCaptureSession {
  sessionId: string
  phase: CaptureSessionPhase
  revision: number
  participantPosition: CaptureSessionPosition
  createdAt: string
  updatedAt: string
  moments: CaptureMomentSummary[]
}

interface CaptureSessionSource {
  opaqueId: unknown
  phase: unknown
  revision: unknown
  createdAt: unknown
  updatedAt: unknown
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isCaptureSessionPhase(
  value: unknown
): value is CaptureSessionPhase {
  return (
    typeof value === 'string' &&
    CAPTURE_SESSION_PHASES.includes(value as CaptureSessionPhase)
  )
}

export function isCaptureSessionPosition(
  value: unknown
): value is CaptureSessionPosition {
  return value === 'A' || value === 'B'
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  )
}

function parseMoments(value: unknown): CaptureMomentSummary[] | null {
  if (!Array.isArray(value) || value.length !== CAPTURE_MOMENT_COUNT) {
    return null
  }

  const indices = value
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const captureIndex = (row as { capture_index?: unknown }).capture_index
      return typeof captureIndex === 'number' && Number.isInteger(captureIndex)
        ? captureIndex
        : null
    })
    .sort((left, right) => (left ?? 0) - (right ?? 0))

  if (
    indices.some(
      (captureIndex, index) => captureIndex !== index + 1
    )
  ) {
    return null
  }

  return indices.map((captureIndex) => ({ captureIndex: captureIndex! }))
}

/**
 * Converts trusted database fields into the deliberately narrow client shape.
 * Internal room, participant, session-row, moment, attempt, and image IDs are
 * never included.
 */
export function parseAuthoritativeCaptureSession(
  source: CaptureSessionSource,
  participantPosition: unknown,
  momentRows: unknown
): AuthoritativeCaptureSession | null {
  const moments = parseMoments(momentRows)

  if (
    typeof source.opaqueId !== 'string' ||
    !UUID_PATTERN.test(source.opaqueId) ||
    !isCaptureSessionPhase(source.phase) ||
    typeof source.revision !== 'number' ||
    !Number.isInteger(source.revision) ||
    source.revision < 1 ||
    !isCaptureSessionPosition(participantPosition) ||
    !isTimestamp(source.createdAt) ||
    !isTimestamp(source.updatedAt) ||
    !moments
  ) {
    return null
  }

  return {
    sessionId: source.opaqueId,
    phase: source.phase,
    revision: source.revision,
    participantPosition,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    moments,
  }
}
