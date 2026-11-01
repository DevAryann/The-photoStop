export const FINALIZED_BACKGROUND_COLORS = [
  '#ffffff',
  '#000000',
  '#faf8f3',
  '#d4f1f0',
  '#fde8e8',
] as const

export const FINALIZED_STRIP_STYLES = ['plain', 'polaroid', 'retro'] as const
export const FINALIZED_PHOTO_FILTERS = [
  'original',
  'vintage',
  'grayscale',
  'warm',
] as const
export const FINALIZED_STICKER_EMOJIS = ['❤️', '⭐', '✨', '🌸', '😊'] as const

export const MAX_FINALIZED_STICKERS = 8
export const FINALIZED_CAPTION_MAX_LENGTH = 80

export type PhotoFilter = (typeof FINALIZED_PHOTO_FILTERS)[number]
export type PhotoStripStyle = (typeof FINALIZED_STRIP_STYLES)[number]

export interface PhotoStripSticker {
  id: string
  emoji: string
  slot: number
}

export interface PhotoStripRenderConfig {
  backgroundColor: string
  stripStyle: PhotoStripStyle
  photoFilter: PhotoFilter
  stickers: PhotoStripSticker[]
  caption: string
}

export interface RoomFinalization {
  photoSetId: string
  finalizedAt: string
  renderConfig: PhotoStripRenderConfig
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isStringInList<T extends string>(
  value: unknown,
  values: readonly T[]
): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

export function isPhotoStripRenderConfig(
  value: unknown
): value is PhotoStripRenderConfig {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<PhotoStripRenderConfig>
  if (
    !isStringInList(candidate.backgroundColor, FINALIZED_BACKGROUND_COLORS) ||
    !isStringInList(candidate.stripStyle, FINALIZED_STRIP_STYLES) ||
    !isStringInList(candidate.photoFilter, FINALIZED_PHOTO_FILTERS) ||
    typeof candidate.caption !== 'string' ||
    candidate.caption.length > FINALIZED_CAPTION_MAX_LENGTH ||
    !Array.isArray(candidate.stickers) ||
    candidate.stickers.length > MAX_FINALIZED_STICKERS
  ) {
    return false
  }

  const usedSlots = new Set<number>()
  const usedIds = new Set<string>()
  return candidate.stickers.every((sticker) => {
    if (!sticker || typeof sticker !== 'object') return false
    const item = sticker as Partial<PhotoStripSticker>
    if (
      typeof item.id !== 'string' ||
      !UUID_PATTERN.test(item.id) ||
      !isStringInList(item.emoji, FINALIZED_STICKER_EMOJIS) ||
      typeof item.slot !== 'number' ||
      !Number.isInteger(item.slot) ||
      item.slot < 0 ||
      item.slot >= MAX_FINALIZED_STICKERS ||
      usedSlots.has(item.slot) ||
      usedIds.has(item.id)
    ) {
      return false
    }

    usedSlots.add(item.slot)
    usedIds.add(item.id)
    return true
  })
}

export function isRoomFinalization(value: unknown): value is RoomFinalization {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RoomFinalization>
  return (
    typeof candidate.photoSetId === 'string' &&
    UUID_PATTERN.test(candidate.photoSetId) &&
    typeof candidate.finalizedAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.finalizedAt)) &&
    isPhotoStripRenderConfig(candidate.renderConfig)
  )
}
