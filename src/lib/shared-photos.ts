export const SHARED_PHOTO_BUCKET = 'room-photos'
export const SHARED_PHOTO_COUNT = 4
export const MAX_SHARED_PHOTO_BYTES = 10 * 1024 * 1024
export const SHARED_PHOTO_SIGNED_URL_TTL_SECONDS = 5 * 60

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isPhotoSetId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function getSharedPhotoPaths(photoSetId: string): string[] {
  return Array.from(
    { length: SHARED_PHOTO_COUNT },
    (_, index) => `photo-sets/${photoSetId}/${index + 1}.jpg`
  )
}
