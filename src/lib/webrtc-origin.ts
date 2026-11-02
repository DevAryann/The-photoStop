// Quick Tunnel assigns one DNS label beneath this exact domain. Do not use a
// loose substring/suffix check that also accepts lookalike domains.
const QUICK_TUNNEL_HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/

function parseHostHeader(value: string | null) {
  // Accept a single authority only, never a proxy chain, URL, userinfo, encoded
  // hostname, or path. URL parsing then validates the hostname/port (incl. IPv6).
  if (!value || !/^[a-z0-9.:[\]-]+$/i.test(value)) return null
  try {
    return new URL(`https://${value}`)
  } catch {
    return null
  }
}

/**
 * Signaling's CSRF boundary is separate from Next's allowedDevOrigins (which
 * protects dev assets/endpoints). Never trust forwarded headers in production.
 */
export function hasValidWebRtcOrigin(request: Request): boolean {
  const value = request.headers.get('origin')
  // Preserve non-browser/no-Origin clients; JSON and capability checks still
  // apply. Opaque, empty, malformed, and multiple origins are not allowed.
  if (value === null) return true

  let origin: URL
  let requestUrl: URL
  try {
    origin = new URL(value)
    requestUrl = new URL(request.url)
  } catch {
    return false
  }
  if (
    (origin.protocol !== 'https:' && origin.protocol !== 'http:') ||
    origin.origin !== value
  ) {
    return false
  }
  if (value === requestUrl.origin) return true

  if (
    process.env.NODE_ENV !== 'development' ||
    origin.protocol !== 'https:' ||
    origin.port !== '' ||
    !QUICK_TUNNEL_HOSTNAME.test(origin.hostname) ||
    request.headers.get('x-forwarded-proto') !== 'https'
  ) {
    return false
  }

  const host = parseHostHeader(request.headers.get('host'))
  const forwardedValue = request.headers.get('x-forwarded-host')
  const forwardedHost = parseHostHeader(forwardedValue)
  if (!host || (forwardedValue !== null && !forwardedHost)) return false

  // Cloudflare normally preserves Host. A different tunnel must not become an
  // allowed cross-origin caller just by supplying a matching forwarded header.
  if (QUICK_TUNNEL_HOSTNAME.test(host.hostname)) {
    return (
      host.host === origin.host &&
      (forwardedValue === null || forwardedHost?.host === origin.host)
    )
  }

  // If a local proxy rewrites Host, require its backend authority/port plus a
  // single, matching public tunnel authority. Arbitrary public Hosts cannot use
  // X-Forwarded-Host to bypass the origin check.
  const isBackendHost =
    host.hostname === requestUrl.hostname ||
    host.hostname === 'localhost' ||
    host.hostname === '127.0.0.1' ||
    host.hostname === '[::1]'
  return (
    isBackendHost &&
    host.port === requestUrl.port &&
    forwardedHost?.host === origin.host
  )
}
