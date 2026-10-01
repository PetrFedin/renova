/**
 * EST-025/026: правка и ручное создание материала — валидация формы и правила действий.
 * Зеркало backend `material_pick_service` (draft/pending правятся, approved отзывается заказчиком).
 */
import { parseNonNegativeNumber } from '@/lib/parseLocaleNumber';

export type MaterialFormInput = {
  name: string;
  qty: string;
  unit: string;
  price?: string;
  /** customer_on_hand: всё количество уже в наличии. */
  allInStock?: boolean;
  availableText?: string;
};

export type MaterialFormResult =
  | { ok: true; name: string; qty: number; unit: string; price: number; available: number }
  | { ok: false; title: string; message: string };

export function parseMaterialForm(input: MaterialFormInput): MaterialFormResult {
  const name = input.name.trim();
  if (!name) return { ok: false, title: 'Название материала', message: 'Укажите, что это за материал.' };
  const qty = parseNonNegativeNumber(input.qty);
  if (qty === null || qty <= 0) {
    return { ok: false, title: 'Количество', message: 'Введите количество числом больше 0, например 12,5.' };
  }
  const unit = input.unit.trim();
  if (!unit || unit.length > 16) {
    return { ok: false, title: 'Единица измерения', message: 'Укажите единицу (шт, м², кг…) до 16 символов.' };
  }
  const price = input.price && input.price.trim() ? parseNonNegativeNumber(input.price) : 0;
  if (price === null) {
    return { ok: false, title: 'Цена материала', message: 'Введите цену числом от 0, например 1 250,50.' };
  }
  let available = 0;
  if (input.allInStock) available = qty;
  else if (input.availableText && input.availableText.trim()) {
    const parsed = parseNonNegativeNumber(input.availableText);
    if (parsed === null || parsed > qty) {
      return { ok: false, title: 'Доступное количество', message: `Введите число от 0 до ${qty}.` };
    }
    available = parsed;
  }
  return { ok: true, name, qty, unit, price, available };
}

export type MaterialEditPolicy = { canEdit: boolean; canDelete: boolean; canRevoke: boolean };

/** Какие действия предлагать; точный запрет (активная закупка, история) всегда за сервером. */
export function materialEditPolicy(status: string, role: string | null | undefined, readOnly?: boolean): MaterialEditPolicy {
  if (readOnly) return { canEdit: false, canDelete: false, canRevoke: false };
  const open = status === 'draft' || status === 'pending';
  return { canEdit: open, canDelete: open, canRevoke: status === 'approved' && role === 'customer' };
}
