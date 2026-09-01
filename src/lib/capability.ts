import crypto from 'crypto'

/**
 * Session Capability Token Generation and Hashing
 *
 * Capability tokens are high-entropy, cryptographically random values used for
 * participant authorization. They are NOT derived from room codes or UUIDs.
 *
 * Security Model:
 * 1. Room Code (discovery): Human-friendly, ~9,000 combinations, shareable, NOT a secret
 * 2. Room UUID (internal): Database identifier, never exposed to clients
 * 3. Session Capability (authorization): High-entropy token, 256-bit, required for all operations
 *
 * Flow:
 * - Server generates capability token (256-bit random)
 * - Server hashes capability with SHA-256
 * - Server stores hash in database (never plaintext)
 * - Server sends raw capability to client in HttpOnly cookie
 * - Client sends cookie with every request
 * - Server hashes incoming capability and validates against stored hash
 *
 * Defense-in-Depth:
 * - If database is compromised, attacker sees only hashes (cannot impersonate sessions)
 * - If cookie is stolen via XSS, HttpOnly flag prevents JavaScript access
 * - If request is intercepted, Secure flag ensures HTTPS-only transmission
 */

/**
 * Generates a cryptographically secure random capability token
 *
 * Uses Node.js crypto.randomBytes() which provides cryptographically strong
 * pseudo-random data suitable for security-sensitive operations.
 *
 * Entropy: 256 bits (32 bytes) - far exceeds 128-bit minimum requirement
 * Encoding: base64url (URL-safe, no padding)
 *
 * @returns A base64url-encoded random string (43 characters)
 *
 * @example
 * const capability = generateCapability()
 * // => "Xq7pL9mK2fR8vN4jT6wY1cE3sA5hB0gD9zM7uI8oP2x"
 */
export function generateCapability(): string {
  // Generate 32 bytes (256 bits) of cryptographically secure random data
  // This exceeds the 128-bit minimum entropy requirement
  const randomBytes = crypto.randomBytes(32)

  // Encode as base64url (URL-safe, no padding)
  // base64url is preferred over base64 for cookie/URL safety
  return randomBytes.toString('base64url')
}

/**
 * Hashes a capability token using SHA-256
 *
 * The hash is stored in the database instead of the plaintext capability.
 * This provides defense-in-depth: if the database is compromised (SQL injection,
 * backup exposure, insider access), attackers cannot derive the original tokens.
 *
 * @param capability - The raw capability token to hash
 * @returns A SHA-256 hex digest (64 characters)
 *
 * @example
 * const capability = generateCapability()
 * const hash = hashCapability(capability)
 * // => "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
 */
export function hashCapability(capability: string): string {
  return crypto.createHash('sha256').update(capability).digest('hex')
}

/**
 * Validates a capability token format
 *
 * Ensures the capability matches the expected base64url format and length.
 * Does NOT validate against the database - this is a format check only.
 *
 * @param capability - The capability token to validate
 * @returns true if the capability format is valid
 *
 * @example
 * isValidCapabilityFormat("Xq7pL9mK2fR8vN4jT6wY1cE3sA5hB0gD9zM7uI8oP2x") // => true
 * isValidCapabilityFormat("invalid") // => false
 */
export function isValidCapabilityFormat(capability: string): boolean {
  // base64url encodes 32 bytes to 43 characters (no padding)
  // Character set: A-Z, a-z, 0-9, -, _
  return /^[A-Za-z0-9_-]{43}$/.test(capability)
}
