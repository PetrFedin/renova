/** Resolve a document link without allowing executable or opaque URL schemes. */
export function resolveSafeDocumentUrl(href?: string | null): string | null {
  const value = href?.trim();
  if (!value) return null;

  const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
  try {
    const parsed = new URL(value, base);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isSafeDocumentUrl(href?: string | null): boolean {
  return resolveSafeDocumentUrl(href) !== null;
}
