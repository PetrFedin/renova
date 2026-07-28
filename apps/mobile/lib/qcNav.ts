/** W121: открыть замечание в QC (Fieldwire-паритет: pin → focused issue) */
import type { OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

/**
 * Всегда строковый href → pushOsNav → resolvePushLink.
 * Объектный pathname /quality-control обходил customer remap (без issueId → hub Приёмка).
 */
export function openQcIssue(issueId: string | undefined, returnTo: string | undefined, role: OsRole) {
  if (issueId) {
    pushOsNav(`/quality-control?issueId=${encodeURIComponent(issueId)}`, returnTo, role);
    return;
  }
  // Без issueId: /control — единый hub Приёмка для обеих ролей
  pushOsNav('/control', returnTo, role);
}
