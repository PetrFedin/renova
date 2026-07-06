/** Приёмка и качество — вкладка «Ремонт → Приёмка» */
import type { OsRole } from '@/constants/osSections';
import { CustomerControlView } from '@/components/screens/control/CustomerControlView';
import { ContractorControlView } from '@/components/screens/control/ContractorControlView';

export function OsControlScreen({ role }: { role: OsRole }) {
  return role === 'contractor' ? <ContractorControlView /> : <CustomerControlView />;
}
