/** Root stack: статический маршрут; SoT UI — (contractor)/_screens/refund-reviews. Только админ. */
import { AdminGate } from '@/components/renova/AdminGate';
import Screen from './(contractor)/_screens/refund-reviews';

export default function RefundReviews_Route() {
  return (
    <AdminGate>
      <Screen />
    </AdminGate>
  );
}
