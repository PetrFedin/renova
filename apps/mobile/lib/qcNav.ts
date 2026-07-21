/** W121: открыть замечание в QC (Fieldwire-паритет: pin → focused issue) */
import type { OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

/** Stack /quality-control с issueId — без remap заказчика в hub без фокуса */
export function openQcIssue(issueId: string | undefined, returnTo: string | undefined, role: OsRole) {
  pushOsNav(
    {
      pathname: '/quality-control',
      params: issueId ? { issueId } : {},
    },
    returnTo,
    role,
  );
}
