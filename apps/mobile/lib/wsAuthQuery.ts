/**
 * WS auth query: prefer short-lived ticket over long JWT in URL (P2.20).
 * Falls back to ?token= if ticket mint fails (offline / old API).
 */
import { API_BASE, getAccessToken } from '@/lib/api/client';

export async function buildWsAuthQuery(): Promise<string> {
  const tok = getAccessToken();
  if (!tok) return '';
  try {
    const r = await fetch(`${API_BASE}/api/v1/auth/ws-ticket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/json',
      },
    });
    if (r.ok) {
      const j = (await r.json()) as { ticket?: string };
      if (j.ticket) {
        return `?ticket=${encodeURIComponent(j.ticket)}`;
      }
    }
  } catch {
    /* fall through to JWT query */
  }
  return `?token=${encodeURIComponent(tok)}`;
}
