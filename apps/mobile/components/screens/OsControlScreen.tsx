/** Repair → Приёмка: единый control hub (очередь приёмок + замечания) */
import type { OsRole } from '@/constants/osSections';
import { CustomerControlView } from '@/components/screens/control/CustomerControlView';
import { ContractorControlView } from '@/components/screens/control/ContractorControlView';
import { TechnicalSupervisionControlView } from '@/components/screens/control/TechnicalSupervisionControlView';
import { useRenova } from '@/lib/context/RenovaContext';

export function OsControlScreen({ role }: { role: OsRole }) {
  const { activeProject } = useRenova();
  if (activeProject?.access_mode === 'supervisor') {
    return <TechnicalSupervisionControlView />;
  }
  if (role === 'contractor') return <ContractorControlView />;
  return <CustomerControlView />;
}
