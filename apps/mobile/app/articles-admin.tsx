/** Root stack: статический маршрут вместо (contractor)/[tool] — иначе /articles-admin сталкивается с [slug] и (tabs)/[legacyTab] (Maximum update depth). SoT UI — (contractor)/_screens/articles-admin */
import { AdminGate } from '@/components/renova/AdminGate';
import Screen from './(contractor)/_screens/articles-admin';

export default function Admin_Route() {
  return (
    <AdminGate>
      <Screen />
    </AdminGate>
  );
}
