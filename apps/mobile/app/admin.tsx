/** Root stack: статический маршрут вместо (contractor)/[tool] — иначе /admin сталкивается с [slug] и (tabs)/[legacyTab] (Maximum update depth). SoT UI — (contractor)/_screens/admin */
import { AdminGate } from '@/components/renova/AdminGate';
import Screen from './(contractor)/_screens/admin';

export default function Admin_Route() {
  return (
    <AdminGate>
      <Screen />
    </AdminGate>
  );
}
