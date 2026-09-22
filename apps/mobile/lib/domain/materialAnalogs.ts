/**
 * Аналоги материала: черновик замены и её выгода.
 *
 * Аналог — это отдельный подбор со ссылкой `analog_of_id` на исходный.
 * Он наследует комнату, единицу, количество и вид работ: меняется то, ради
 * чего аналог и предлагают — название и цена.
 */
import type { MaterialPick } from '@/lib/api/types/budget';

export type AnalogDraft = {
  name: string;
  qty: number;
  unit: string;
  price: number;
  room_id: string | null;
  work_type: string | null;
  analog_of_id: string;
};

export type AnalogInput = { name: string; price: string };

export type AnalogDraftResult =
  | { ok: true; draft: AnalogDraft }
  | { ok: false; message: string };

export function parsePriceInput(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

export function buildAnalogDraft(original: MaterialPick, input: AnalogInput): AnalogDraftResult {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, message: 'Укажите, чем заменяем материал.' };
  if (name.length > 255) return { ok: false, message: 'Название длиннее 255 символов — сократите.' };
  const price = parsePriceInput(input.price);
  if (price === null) return { ok: false, message: 'Цена — число без букв, например 1 250 или 1250,50.' };
  return {
    ok: true,
    draft: {
      name,
      // Количество и единица наследуются: аналог заменяет тот же объём,
      // иначе сравнение цен потеряет смысл.
      qty: original.qty,
      unit: original.unit,
      price,
      room_id: original.room_id ?? null,
      work_type: original.work_type ?? null,
      analog_of_id: original.id,
    },
  };
}

/** Разница в итоге за тот же объём: отрицательная — аналог дешевле. */
export function analogDelta(original: MaterialPick, analogPrice: number): number {
  return Math.round((analogPrice - original.price) * original.qty * 100) / 100;
}

export function analogDeltaLabel(delta: number): string {
  if (delta === 0) return 'Столько же, сколько исходный материал';
  const amount = Math.abs(delta).toLocaleString('ru-RU');
  return delta < 0 ? `Дешевле на ${amount} ₽` : `Дороже на ${amount} ₽`;
}

/** Подпись строки-аналога: без имени исходного материала она бессмысленна. */
export function analogParentLabel(
  pick: MaterialPick,
  all: readonly MaterialPick[],
): string {
  if (!pick.analog_of_id) return '';
  const parent = all.find((item) => item.id === pick.analog_of_id);
  return parent ? `аналог к «${parent.name}»` : 'аналог';
}

/** Аналог аналога — путаница, а не выбор: предлагаем замену только исходному. */
export function canOfferAnalog(pick: MaterialPick): boolean {
  return !pick.analog_of_id && pick.status !== 'purchased';
}
