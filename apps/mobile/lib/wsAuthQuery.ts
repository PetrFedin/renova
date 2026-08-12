/**
 * WS auth query: only a short-lived ticket may appear in the WebSocket URL.
 * Long-lived access JWTs are used only in the HTTPS Authorization header that
 * mints the ticket and are never downgraded into a URL query parameter.
 */
import { API_BASE, getAccessToken } from '@/lib/api/client';
import { reportError } from '@/lib/reportError';

function asWsAuthError(error: unknown): Error {
  return error instanceof Error ? error : new Error('ws_auth_ticket_unavailable');
}

export async function buildWsAuthQuery(): Promise<string> {
  try {
    const tok = getAccessToken();
    if (!tok) throw new Error('ws_auth_access_token_missing');

    const r = await fetch(`${API_BASE}/api/v1/auth/ws-ticket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/json',
      },
    });
    if (!r.ok) throw new Error(`ws_auth_ticket_http_${r.status}`);

    const j = (await r.json()) as { ticket?: string };
    const ticket = j.ticket?.trim();
    if (!ticket) throw new Error('ws_auth_ticket_missing');

    return `?ticket=${encodeURIComponent(ticket)}`;
  } catch (error) {
    const normalized = asWsAuthError(error);
    reportError('wsAuth.ticket', normalized);
    throw normalized;
  }
}
