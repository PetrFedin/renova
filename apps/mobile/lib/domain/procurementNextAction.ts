/**
 * P2.4 / W50: один «следующий шаг» снабжения — без гадания по вкладкам.
 */
export type ProcurementNextAction = {
  id: 'generate' | 'approve_picks' | 'create_purchase' | 'advance_purchase' | 'scan_receipt' | 'done';
  title: string;
  subtab: 'picks' | 'purchases' | 'receipts';
  cta: string;
};

type PickLike = { id: string; status: string };
type PurchaseLike = { id: string; status: string; items: { material_pick_id?: string | null }[] };
type ReceiptLike = { verified?: boolean };

export function pickIdsInActivePurchases(purchases: PurchaseLike[]): Set<string> {
  const ids = new Set<string>();
  for (const p of purchases) {
    if (p.status === 'cancelled') continue;
    for (const i of p.items || []) {
      if (i.material_pick_id) ids.add(i.material_pick_id);
    }
  }
  return ids;
}

/** Позиции, из которых можно создать закупку */
export function readyPickIds(picks: PickLike[], purchases: PurchaseLike[]): string[] {
  // W64: только approved — draft/pending требуют согласования заказчика (backend 409)
  const inPurchase = pickIdsInActivePurchases(purchases);
  return picks.filter((p) => p.status === 'approved' && !inPurchase.has(p.id)).map((p) => p.id);
}

export function procurementNextAction(
  picks: PickLike[],
  purchases: PurchaseLike[],
  receipts: ReceiptLike[],
): ProcurementNextAction {
  if (!picks.length) {
    return {
      id: 'generate',
      title: 'Нет потребностей — рассчитайте материалы из сметы',
      subtab: 'picks',
      cta: 'Из сметы',
    };
  }
  const ready = readyPickIds(picks, purchases);
  const pendingApprove = picks.filter((p) => p.status === 'pending').length;
  if (pendingApprove > 0 && !ready.filter((id) => picks.find((p) => p.id === id)?.status === 'approved').length) {
    // есть только pending без approved ready — заказчику согласовать
    const onlyPending = ready.every((id) => picks.find((p) => p.id === id)?.status === 'pending');
    if (onlyPending || (!ready.length && pendingApprove)) {
      return {
        id: 'approve_picks',
        title: `${pendingApprove} материал(ов) ждут согласования заказчика`,
        subtab: 'picks',
        cta: 'К потребностям',
      };
    }
  }
  if (ready.length) {
    return {
      id: 'create_purchase',
      title: `Создайте закупку: ${ready.length} поз. готовы`,
      subtab: 'purchases',
      cta: 'Создать закупку',
    };
  }
  const open = purchases.find((p) => p.status !== 'delivered' && p.status !== 'cancelled');
  if (open) {
    const step =
      open.status === 'draft' || open.status === 'approved'
        ? 'отметьте заказ у поставщика'
        : open.status === 'ordered'
          ? 'отметьте оплату'
          : 'отметьте доставку';
    return {
      id: 'advance_purchase',
      title: `Открытая закупка — ${step}`,
      subtab: 'purchases',
      cta: 'К закупкам',
    };
  }
  const unverified = receipts.filter((r) => !r.verified).length;
  if (unverified > 0 || receipts.length === 0) {
    return {
      id: 'scan_receipt',
      title: unverified > 0 ? `${unverified} чек(ов) без сверки` : 'Привяжите чек к доставке — факт в бюджете',
      subtab: 'receipts',
      cta: 'Сканировать чек',
    };
  }
  return {
    id: 'done',
    title: 'Снабжение в порядке — потребности закрыты',
    subtab: 'picks',
    cta: 'Обновить',
  };
}
