/** Repair → Приёмка: единый control hub (очередь приёмок + замечания) */
import type { OsRole } from '@/constants/osSections';
import { CustomerControlView } from '@/components/screens/control/CustomerControlView';
import { ContractorControlView } from '@/components/screens/control/ContractorControlView';

export function OsControlScreen({ role }: { role: OsRole }) {
  if (role === 'contractor') return <ContractorControlView />;
  return <CustomerControlView />;
}
