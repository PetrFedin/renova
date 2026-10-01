/** Root stack: статический маршрут; SoT UI — (contractor)/_screens/provider-reconciliations. Только админ. */
import { AdminGate } from '@/components/renova/AdminGate';
import Screen from './(contractor)/_screens/provider-reconciliations';

export default function ProviderReconciliations_Route() {
  return (
    <AdminGate>
      <Screen />
    </AdminGate>
  );
}
