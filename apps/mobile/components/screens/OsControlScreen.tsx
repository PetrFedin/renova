/** Repair → Приёмка: единый control hub (очередь приёмок + замечания) */
import type { OsRole } from '@/constants/osSections';
import { CustomerControlView } from '@/components/screens/control/CustomerControlView';
import { ContractorControlView } from '@/components/screens/control/ContractorControlView';
import { TechnicalSupervisionControlView } from '@/components/screens/control/TechnicalSupervisionControlView';
import { useRenova } from '@/lib/context/RenovaContext';
import { effectiveAcceptanceRole } from '@/lib/domain/acceptanceActions';

export function OsControlScreen({ role }: { role: OsRole }) {
  const { activeProject, user } = useRenova();
  if (activeProject?.access_mode === 'supervisor') {
    return <TechnicalSupervisionControlView />;
  }
  // UI-010: роль экрана — по сессии, а не только по группе маршрута
  if (effectiveAcceptanceRole(user?.role, role === 'contractor' ? 'contractor' : 'customer') === 'contractor') return <ContractorControlView />;
  return <CustomerControlView />;
}
