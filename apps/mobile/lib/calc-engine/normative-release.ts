import { CALC_NORMATIVES, type CalcNormativeCatalog } from './templates';

export type NormativeCurrency = 'RUB';

export interface NormativeReleaseMetadata {
  catalogId: string;
  version: string;
  region: string;
  currency: NormativeCurrency;
  effectiveFrom: string;
}

export interface NormativeReleaseSnapshot {
  metadata: Readonly<NormativeReleaseMetadata>;
  values: DeepReadonly<CalcNormativeCatalog>;
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/**
 * Идентификатор действующего набора нормативов MVP.
 * Он должен сохраняться вместе со сметой, чтобы позднее можно было
 * воспроизвести расчёт даже после изменения цен или коэффициентов.
 */
export const CURRENT_NORMATIVE_RELEASE: Readonly<NormativeReleaseMetadata> = deepFreeze({
  catalogId: 'renova-mvp-ru',
  version: '1.0.0',
  region: 'RU',
  currency: 'RUB',
  effectiveFrom: '2026-07-26',
});

/**
 * Возвращает независимый неизменяемый снимок текущих нормативов.
 * Потребители могут безопасно сохранять его в проекте, смете или журнале
 * пересчётов: последующие обновления каталога не изменят старый снимок.
 */
export function createCurrentNormativeSnapshot(): NormativeReleaseSnapshot {
  return deepFreeze({
    metadata: cloneJson(CURRENT_NORMATIVE_RELEASE),
    values: cloneJson(CALC_NORMATIVES),
  });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }

  return value as DeepReadonly<T>;
}
