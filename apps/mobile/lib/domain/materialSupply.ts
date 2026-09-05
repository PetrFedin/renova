import type { MaterialSupplySource } from '@/lib/api';

export type ProcurementRole = 'customer' | 'contractor';

export type MaterialSupplyTruth = {
  status?: string;
  qty: number;
  qty_needed?: number | null;
  qty_available?: number;
  qty_delivered?: number;
  qty_to_buy?: number;
  supply_source?: MaterialSupplySource;
};

export const MATERIAL_SUPPLY_LABELS: Record<MaterialSupplySource, string> = {
  customer_on_hand: 'У заказчика',
  customer_to_buy: 'Покупает заказчик',
  contractor_to_buy: 'Покупает исполнитель',
  contractor_included: 'Включено в работы',
  third_party: 'Поставляет третья сторона',
};

export const MATERIAL_SUPPLY_OPTIONS: { value: MaterialSupplySource; label: string }[] = [
  { value: 'customer_on_hand', label: MATERIAL_SUPPLY_LABELS.customer_on_hand },
  { value: 'customer_to_buy', label: MATERIAL_SUPPLY_LABELS.customer_to_buy },
  { value: 'contractor_to_buy', label: MATERIAL_SUPPLY_LABELS.contractor_to_buy },
  { value: 'contractor_included', label: MATERIAL_SUPPLY_LABELS.contractor_included },
  { value: 'third_party', label: MATERIAL_SUPPLY_LABELS.third_party },
];

export function supplyLabel(source?: MaterialSupplySource): string {
  return source ? MATERIAL_SUPPLY_LABELS[source] : 'Источник не указан';
}

export function requiredQty(pick: Pick<MaterialSupplyTruth, 'qty' | 'qty_needed'>): number {
  return Math.max(pick.qty_needed ?? pick.qty ?? 0, 0);
}

export function totalAvailableQty(
  pick: Pick<MaterialSupplyTruth, 'qty_available' | 'qty_delivered'>,
): number {
  return Math.max(pick.qty_available ?? 0, 0) + Math.max(pick.qty_delivered ?? 0, 0);
}

export function quantityToBuy(pick: MaterialSupplyTruth): number {
  if (typeof pick.qty_to_buy === 'number') return Math.max(pick.qty_to_buy, 0);
  if (pick.supply_source !== 'customer_to_buy' && pick.supply_source !== 'contractor_to_buy') return 0;
  return Math.max(requiredQty(pick) - totalAvailableQty(pick), 0);
}

export function roleOwnsPurchase(source: MaterialSupplySource | undefined, role: ProcurementRole): boolean {
  return (source === 'customer_to_buy' && role === 'customer')
    || (source === 'contractor_to_buy' && role === 'contractor');
}

export function needsAvailabilityUpdate(pick: MaterialSupplyTruth): boolean {
  if (pick.status !== 'approved') return false;
  if (pick.supply_source === 'customer_to_buy' || pick.supply_source === 'contractor_to_buy') return false;
  return totalAvailableQty(pick) + Number.EPSILON < requiredQty(pick);
}
