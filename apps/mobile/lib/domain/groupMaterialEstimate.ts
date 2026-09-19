/**
 * Расчёт материалов, сгруппированный так, как его читает человек.
 *
 * Плитка и ламинат ложатся на один и тот же пол, краска и обои — на одни и те
 * же стены. Расчёт отдавал их подряд, и экран показывал
 *
 *     Плитка: 13.2 м²
 *     Ламинат: 12.84 м²
 *
 * — один пол, посчитанный дважды. Это читается как список покупок, хотя на
 * деле это выбор: либо одно, либо другое.
 *
 * Здесь позиции собираются по поверхностям, а внутри поверхности —
 * конкурирующие варианты помечаются как выбор. Сопутствующее (клей и затирка
 * под плитку) привязано к своему варианту и показывается вместе с ним.
 */

export type MaterialItem = {
  name: string;
  unit: string;
  qty: number;
  category: string;
  note?: string;
  surface?: string;
  alternative_group?: string | null;
  requires?: string;
};

export type MaterialChoice = {
  /** Название варианта, например «Плитка». */
  name: string;
  unit: string;
  qty: number;
  note?: string;
  /** То, что нужно вместе с этим вариантом: клей, затирка. */
  companions: MaterialItem[];
};

export type MaterialSurface = {
  surface: string;
  label: string;
  /** Взаимоисключающие варианты отделки. Пусто, если выбора нет. */
  choices: MaterialChoice[];
  /** Позиции, нужные независимо от выбора. */
  always: MaterialItem[];
};

const SURFACE_LABEL: Record<string, string> = {
  floor: 'Пол',
  walls: 'Стены',
  trim: 'Отделка примыканий',
  other: 'Прочее',
};

const SURFACE_ORDER = ['floor', 'walls', 'trim', 'other'];

export function groupMaterialEstimate(items: MaterialItem[]): MaterialSurface[] {
  const bySurface = new Map<string, MaterialItem[]>();
  for (const item of items) {
    const surface = item.surface || 'other';
    const list = bySurface.get(surface) || [];
    list.push(item);
    bySurface.set(surface, list);
  }

  const result: MaterialSurface[] = [];
  for (const surface of [...SURFACE_ORDER, ...bySurface.keys()]) {
    const list = bySurface.get(surface);
    if (!list) continue;
    bySurface.delete(surface);

    const alternatives = list.filter((item) => item.alternative_group);
    const companions = list.filter((item) => item.requires);
    const always = list.filter((item) => !item.alternative_group && !item.requires);

    result.push({
      surface,
      label: SURFACE_LABEL[surface] || surface,
      choices: alternatives.map((item) => ({
        name: item.name,
        unit: item.unit,
        qty: item.qty,
        note: item.note,
        companions: companions.filter((companion) => companion.requires === item.name),
      })),
      always,
    });
  }
  return result;
}

/**
 * Одна строка на выбор — чтобы экран не изобретал формулировку заново.
 *
 * Именно здесь «или» становится видимым: пока вариантов больше одного,
 * складывать их нельзя.
 */
export function choiceSummary(surface: MaterialSurface): string {
  if (surface.choices.length === 0) return '';
  if (surface.choices.length === 1) {
    const only = surface.choices[0];
    return `${only.name} · ${only.qty} ${only.unit}`;
  }
  return surface.choices.map((choice) => `${choice.name} ${choice.qty} ${choice.unit}`).join(' или ');
}

/** Сколько позиций реально придётся купить при любом выборе. */
export function alwaysNeededCount(surfaces: MaterialSurface[]): number {
  return surfaces.reduce((sum, surface) => sum + surface.always.length, 0);
}
