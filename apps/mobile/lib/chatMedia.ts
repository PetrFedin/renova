/** Вложения чата приватны (thread ACL, COM-003): грузим только со своего API и с Authorization. */

const MEDIA_PREFIX = '/api/v1/media/';

export type ChatMediaRequest = { uri: string; authorized: boolean };

/**
 * Адрес вложения → куда реально ходить и нужен ли токен.
 * Ссылки на `/api/v1/media/...` перенаправляются на наш `apiBase` (host из ссылки сервера может
 * отличаться от клиентского), токен уходит ТОЛЬКО туда. Любой другой адрес токена не получает.
 */
export function resolveChatMediaRequest(imageUrl: string, apiBase: string): ChatMediaRequest {
  const base = apiBase.replace(/\/+$/, '');
  let pathAndQuery: string | null = null;
  try {
    const u = new URL(imageUrl, `${base}/`);
    if (u.pathname.startsWith(MEDIA_PREFIX)) pathAndQuery = `${u.pathname}${u.search}`;
  } catch {
    pathAndQuery = null;
  }
  if (pathAndQuery) return { uri: `${base}${pathAndQuery}`, authorized: true };
  return { uri: imageUrl, authorized: false };
}
