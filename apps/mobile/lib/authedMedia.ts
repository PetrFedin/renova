/**
 * OBJ-16: приватные файлы (`/api/v1/media/...`) нельзя открыть ни `<Image uri>`, ни
 * `Linking.openURL` — они не шлют Authorization (сервер отвечает 401). Берём blob через
 * fetch с токеном, и только со своего API (токен чужим хостам не отдаём).
 */
import { API_BASE, authHeaders } from '@/lib/api/client';
import { resolveChatMediaRequest } from '@/lib/chatMedia';

export async function fetchAuthedMediaBlob(userId: string, url: string): Promise<Blob> {
  const request = resolveChatMediaRequest(url, API_BASE);
  const r = await fetch(request.uri, { headers: request.authorized ? authHeaders(userId) : undefined });
  if (!r.ok) throw new Error(`media_http_${r.status}`);
  return r.blob();
}
