export const CAPTURE_MOMENT_COUNT = 6

export const CAPTURE_SESSION_PHASES = [
  'camera_setup',
  'preparing',
  'countdown',
  'capturing',
  'selecting',
  'editing',
  'finalizing',
  'finalized',
] as const

export type CaptureSessionPhase = (typeof CAPTURE_SESSION_PHASES)[number]
export type CaptureSessionPosition = 'A' | 'B'

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
