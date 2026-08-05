import type { OutboxDeadLetter } from '@/lib/api/admin';

export type DeadLetterLocalClaim = {
  token: string;
  expiresAt: string;
};

export function deadLetterClaimLabel(item: OutboxDeadLetter): string {
  switch (item.claim_state) {
    case 'claimed_self':
      return 'Взято вами';
    case 'claimed':
      return 'В работе у другого администратора';
    case 'expired':
      return 'Захват просрочен';
    default:
      return 'Свободно';
  }
}

export function canClaimDeadLetter(item: OutboxDeadLetter): boolean {
  return item.replayable && (item.claim_state === 'unclaimed' || item.claim_state === 'expired');
}

export function canReplayDeadLetter(
  item: OutboxDeadLetter,
  localClaim?: DeadLetterLocalClaim,
  nowMs = Date.now(),
): boolean {
  if (!item.replayable || item.claim_state !== 'claimed_self' || !localClaim?.token) return false;
  const expiresAt = Date.parse(localClaim.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

export function formatDeadLetterDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(parsed));
}

export function deadLetterSafeSummary(item: OutboxDeadLetter): string {
  const error = item.error_code || 'ошибка не классифицирована';
  const fingerprint = item.error_fingerprint ? ` · ${item.error_fingerprint}` : '';
  return `${item.event_type} · ${item.aggregate_type} · ${item.attempts}/${item.max_attempts} · ${error}${fingerprint}`;
}

export function deadLetterDispatchLabel(status?: string): string {
  switch (status) {
    case 'delivered':
      return 'Доставка выполнена';
    case 'retry_scheduled':
      return 'Повтор поставлен в очередь';
    case 'poisoned':
      return 'Событие снова остановлено после ошибки';
    case 'processed':
      return 'Событие уже обработано';
    case 'fenced':
      return 'Операция завершена другим worker';
    default:
      return 'Событие возвращено в очередь';
  }
}
