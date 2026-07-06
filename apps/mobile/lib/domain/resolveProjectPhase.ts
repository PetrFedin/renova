/** Фаза проекта для главной — одна строка статуса и логика «Сделать сейчас» */
import type { ProjectOsSnapshot } from './osTypes';

export type ProjectPhase = 'active' | 'closing' | 'complete';

/** Подписи под названием объекта — как hint у KPI («работы завершены») */
export type ProjectHeaderMeta = {
  context: string;
  status?: string;
};

export function resolveProjectPhase(snap: Pick<ProjectOsSnapshot, 'isComplete' | 'pendingPayments'>): ProjectPhase {
  if (snap.isComplete && snap.pendingPayments > 0) return 'closing';
  if (snap.isComplete) return 'complete';
  return 'active';
}

/** Подпись под названием — только контекст объекта; фаза/оплаты в KPI и «Сделать сейчас» */
export function formatProjectPhaseSubtitle(
  propertyType: string | undefined,
  roomsCount: number,
  address?: string | null,
): string {
  const type = propertyType === 'house' ? 'Дом' : 'Квартира';
  const parts = [`${type} · ${roomsCount} комн.`];
  const addr = address?.trim();
  if (addr) parts.push(addr.length > 32 ? `${addr.slice(0, 30)}…` : addr);
  return parts.join(' · ');
}

/** Контекст объекта + статус фазы — мелкий текст под названием на главной */
export function formatProjectHeaderMeta(
  propertyType: string | undefined,
  roomsCount: number,
  address: string | null | undefined,
  snap: Pick<ProjectOsSnapshot, 'isComplete' | 'pendingPayments' | 'pendingPaymentTotal'>,
): ProjectHeaderMeta {
  const context = formatProjectPhaseSubtitle(propertyType, roomsCount, address);
  const phase = resolveProjectPhase(snap);
  let status: string | undefined;

  // В closing сумма и CTA — только в «Сделать сейчас»; в KPI — число счетов.
  // Здесь не дублируем «315 143 ₽ к оплате» (иначе три раза на экране).
  if (phase === 'complete') {
    status = 'проект завершён';
  }

  return { context, status };
}

/** В фазе «Закрытие» вторичные задачи — только оплата, приёмка, документы, согласования */
export function isClosingPhaseSecondary(kind: string): boolean {
  return ['payment', 'acceptance', 'approval', 'chat'].includes(kind);
}
