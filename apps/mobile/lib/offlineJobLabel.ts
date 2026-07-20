/** Человекочитаемые подписи offline-задач */
import type { OfflineJob } from '@/lib/offlineQueue';

export function offlineJobLabel(j: OfflineJob): string {
  const p = j.path;
  if (p.includes('/comments')) return 'Комментарий этапа';
  if (p.includes('/photos')) return 'Фото этапа';
  if (p.includes('/messages')) return 'Сообщение чата';
  if (p.includes('/rooms/') && j.method === 'PATCH') return 'Изменение комнаты';
  if (p.includes('/receipts/manual')) return 'Расход без чека';
  if (p.includes('/receipts')) return 'Чек';
  if (p.includes('/work-acceptances') && p.includes('/return')) return 'Возврат приёмки';
  if (p.includes('/work-acceptances') && p.includes('/accept')) return 'Решение по приёмке';
  if (p.includes('/work-acceptances')) return 'Запрос приёмки';
  if (p.includes('/warranty-claims')) return 'Гарантийное обращение';
  if (p.includes('/escalate')) return 'Эскалация спора';
  if (p.includes('/submit')) return 'Сдача этапа';
  if (p.includes('/reject')) return 'Отклонение этапа';
  if (p.includes('/accept')) return 'Приёмка этапа';
  if (p.includes('/confirm')) return 'Подтверждение оплаты';
  return `${j.method} ${p.split('/').slice(-2).join('/')}`;
}

export function offlineJobPreview(j: OfflineJob): string {
  try {
    const b = JSON.parse(j.body);
    if (b.text) return b.text.slice(0, 80);
    if (b.caption) return b.caption;
    if (b.amount) return `${b.amount} ₽${b.description ? ': ' + b.description.slice(0, 40) : ''}`;
    if (b.name) return `${b.name}`;
  } catch { /* ignore */ }
  return j.body.slice(0, 60);
}
