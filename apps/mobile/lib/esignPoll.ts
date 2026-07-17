/** Polling статуса Kontur/in_app подписи после create_signature */
import { api } from '@/lib/api';

type SigRow = { provider?: string; signature_type?: string; status?: string; signed_at?: string | null };

export async function pollDocumentSignature(
  userId: string,
  projectId: string,
  documentId: string,
  opts?: { provider?: string; attempts?: number; intervalMs?: number },
): Promise<'signed' | 'pending' | 'failed'> {
  const provider = opts?.provider ?? 'kontur';
  const attempts = opts?.attempts ?? 12;
  const intervalMs = opts?.intervalMs ?? 2000;

  for (let i = 0; i < attempts; i++) {
    const res = await api.listProjectDocuments(userId, projectId);
    const doc = res.items.find((d) => d.id === documentId);
    const sigs = (doc?.meta?.signatures ?? []) as SigRow[];
    const match = sigs.find((s) => s.provider === provider || s.signature_type === provider);
    if (match?.signed_at || match?.status === 'signed') return 'signed';
    if (match?.status === 'failed' || match?.status === 'unavailable') return 'failed';
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return 'pending';
}
