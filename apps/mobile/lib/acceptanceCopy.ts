/** Тексты листа «Этап принят» (чистый модуль — без RN-зависимостей, покрыт тестами). */
/** Бэкенд mark_acceptance_pin_on_plan ставит label «✓ этап» на FloorPlanPin */
export const ACCEPTANCE_PIN_HINT =
  'На плане этажа метка комнаты обновится на «✓ этап». Можно оплатить работы или открыть план.';

export const ACCEPTANCE_NO_PLAN_HINT = 'Этап принят. Можно перейти к оплате работ.';

/** Текст листа «Этап принят»: про метку на плане говорим только если план этажа загружен. */
export function stageAcceptedMessage(hasPlan: boolean): string {
  return hasPlan ? ACCEPTANCE_PIN_HINT : ACCEPTANCE_NO_PLAN_HINT;
}
