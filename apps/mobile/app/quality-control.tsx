import { QualityControlScreen } from '@/components/screens/QualityControlScreen';
import { RouteAudienceGuard } from '@/components/routing/RouteAudienceGuard';

export default function QualityControlRoute() {
  // O-1: заказчик по прямой ссылке попадает в хаб «Ремонт → Приёмка», а не на экран исполнителя.
  return (
    <RouteAudienceGuard path="/quality-control">
      <QualityControlScreen />
    </RouteAudienceGuard>
  );
}
