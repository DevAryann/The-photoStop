/**
 * Room Code Generation
 *
 * Generates human-readable, memorable room codes in the format WORD-##
 * (e.g., "MOON-47", "STAR-92")
 *
 * Format: WORD-## where:
 * - WORD: One of ~100 curated words
 * - ##: Number from 10-99 (90 possibilities)
 * - Total combinations: ~9,000
 *
 * Security Notes:
 * - Room codes are NOT authorization credentials
 * - They are discovery/sharing mechanisms only
 * - Authorization is enforced via session capability tokens
 * - Collisions are handled by database UNIQUE constraint
 */

const ROOM_CODE_WORDS = [
  'MOON',
  'STAR',
  'CLOUD',
  'WAVE',
  'SNOW',
  'RAIN',
  'WIND',
  'FIRE',
  'EARTH',
  'SKY',
  'SUN',
  'LEAF',
  'TREE',
  'ROCK',
  'SAND',
  'OCEAN',
  'RIVER',
  'LAKE',
  'PEAK',
  'HILL',
  'CAVE',
  'FIELD',
  'FOREST',
  'MEADOW',
  'GARDEN',
  'BLOOM',
  'PETAL',
  'SEED',
  'ROOT',
  'BRANCH',
  'FRUIT',
  'BERRY',
  'FAUNA',
  'FLORA',
  'CORAL',
  'SHELL',
  'PEARL',
  'STONE',
  'CRYSTAL',
  'GEM',
  'AMBER',
  'JADE',
  'RUBY',
  'OPAL',
  'LIGHT',
  'GLOW',
  'SHINE',
  'SPARK',
  'FLASH',
  'BEAM',
  'RAY',
  'AURORA',
  'COMET',
  'NOVA',
  'ORBIT',
  'LUNAR',
  'SOLAR',
  'COSMIC',
  'GALAXY',
  'NEBULA',
  'QUASAR',
  'PHOENIX',
  'EAGLE',
  'HAWK',
  'FALCON',
  'RAVEN',
  'SWAN',
  'CRANE',
  'HERON',
  'ROBIN',
  'LARK',
  'FINCH',
  'DOVE',
  'OWL',
  'WOLF',
  'BEAR',
  'FOX',
  'LYNX',
  'OTTER',
  'SEAL',
  'WHALE',
  'DOLPHIN',
  'TIGER',
  'LION',
  'PANDA',
  'KOALA',
  'SLOTH',
  'ZEBRA',
  'GIRAFFE',
  'RHINO',
  'BISON',
  'MOOSE',
  'DEER',
  'ELK',
  'MUSE',
  'ECHO',
  'POEM',
  'SONG',
  'TALE',
  'MYTH',
  'DREAM',
] as const

/**
 * Generates a random room code in the format WORD-##
 *
 * @returns A room code string (e.g., "MOON-47")
 *
 * @example
 * const code = generateRoomCode()
 * // => "STAR-42"
 */
export function generateRoomCode(): string {
  // Select random word from list
  const word = ROOM_CODE_WORDS[Math.floor(Math.random() * ROOM_CODE_WORDS.length)]

  // Generate random number from 10-99 (90 possibilities)
  const number = Math.floor(Math.random() * 90) + 10

  return `${word}-${number}`
}

/**
 * Validates a room code format
 *
 * @param code - The room code to validate
 * @returns true if the code matches the expected format
 *
 * @example
 * isValidRoomCodeFormat("MOON-47") // => true
 * isValidRoomCodeFormat("invalid") // => false
 */
export function isValidRoomCodeFormat(code: string): boolean {
  // Must match: UPPERCASE-## where ## is 10-99
  // Allow flexibility for future word additions
  return /^[A-Z]+-[1-9][0-9]$/.test(code)
}
