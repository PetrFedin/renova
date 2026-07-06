/** Найти доставленную закупку по material pick — для «убрать из факта» */
import type { Purchase } from '@/lib/api';

export function findDeliveredPurchaseForPick(purchases: Purchase[], pickId: string): Purchase | null {
  return (
    purchases.find(
      (p) => p.status === 'delivered' && p.items.some((i) => i.material_pick_id === pickId),
    ) ?? null
  );
}
