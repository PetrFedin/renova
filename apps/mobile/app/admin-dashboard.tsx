/** Root stack: статический маршрут вместо (contractor)/[tool] — иначе /admin-dashboard сталкивается с [slug] и (tabs)/[legacyTab] (Maximum update depth). SoT UI — (contractor)/_screens/admin-dashboard */
import { AdminGate } from '@/components/renova/AdminGate';
import Screen from './(contractor)/_screens/admin-dashboard';

export default function Admin_Route() {
  return (
    <AdminGate>
      <Screen />
    </AdminGate>
  );
}
