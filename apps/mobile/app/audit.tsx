/** Root stack: статический маршрут вместо (contractor)/[tool] — иначе /audit сталкивается с [slug] и (tabs)/[legacyTab] (Maximum update depth). SoT UI — (contractor)/_screens/audit */
import { AdminGate } from '@/components/renova/AdminGate';
import Screen from './(contractor)/_screens/audit';

export default function Admin_Route() {
  return (
    <AdminGate>
      <Screen />
    </AdminGate>
  );
}
