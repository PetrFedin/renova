/** Смета (план) — вкладка «Объект → Смета» */
import type { OsRole } from '@/constants/osSections';
import { CustomerEstimateView } from '@/components/screens/estimate/CustomerEstimateView';
import { ContractorEstimateView } from '@/components/screens/estimate/ContractorEstimateView';

import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

export function OsEstimateScreen({ role, onNextTab }: { role: OsRole; onNextTab?: (tab: ObjectTabId) => void }) {
  return role === 'contractor'
    ? <ContractorEstimateView />
    : <CustomerEstimateView onNextTab={onNextTab} />;
}
