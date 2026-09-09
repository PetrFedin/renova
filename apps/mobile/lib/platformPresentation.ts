const ALLOWED_PLATFORM_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_CONTACT_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function normalizedUrl(raw: string, allowedProtocols: Set<string>, stripTracking: boolean): string | null {
  const value = raw.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!allowedProtocols.has(url.protocol)) return null;
    if (stripTracking) {
      url.search = '';
      url.hash = '';
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Public presentation URL encoded into the QR.
 *
 * A configured URL wins so a branded domain can remain stable while hosting
 * changes. Query/hash are deliberately removed: campaign parameters must not
 * become part of the canonical QR identity.
 */
export function resolveCanonicalPlatformUrl(
  configured?: string | null,
  runtimeOrigin?: string | null,
): string | null {
  if (configured) {
    const canonical = normalizedUrl(configured, ALLOWED_PLATFORM_PROTOCOLS, true);
    if (canonical) return canonical;
  }

  if (!runtimeOrigin) return null;

  try {
    const origin = new URL(runtimeOrigin);
    if (!ALLOWED_PLATFORM_PROTOCOLS.has(origin.protocol)) return null;
    return new URL('/platform', origin).toString();
  } catch {
    return null;
  }
}

export function resolvePlatformContactUrl(configured?: string | null): string | null {
  if (!configured) return null;
  return normalizedUrl(configured, ALLOWED_CONTACT_PROTOCOLS, false);
}
