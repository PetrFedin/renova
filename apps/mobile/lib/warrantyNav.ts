/** W126: гарантия post-closeout → QC / closeout SoT (Buildertrend heritage).
 * Clarity E: sheet вместо Alert. */
import { openQcIssue } from '@/lib/qcNav';
import { pushOsNav } from '@/lib/pushOsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import type { OsRole } from '@/constants/osSections';

export type WarrantyCreateInfo = {
  issue_id?: string;
  document_id?: string;
  post_closeout?: boolean;
  sla_days?: number;
};

/** Сообщение после создания тикета */
export function warrantyCreatedMessage(info: WarrantyCreateInfo, openCount?: number): string {
  const sla = info.sla_days || 14;
  const post = info.post_closeout ? ' (после сдачи)' : '';
  const open = openCount != null ? ` Открытых: ${openCount}.` : '';
  const doc = info.document_id ? ` Документ: ${info.document_id.slice(0, 8)}…` : '';
  return `Тикет создан${post}. SLA ${sla} дн.${open}${doc}`;
}

/** Создано → фокус в QC (заказчик и исполнитель) */
export function alertWarrantyCreated(
  role: OsRole,
  info: WarrantyCreateInfo,
  opts?: { openCount?: number; returnTo?: string },
) {
  showActionConfirm({
    title: 'Гарантия',
    message: warrantyCreatedMessage(info, opts?.openCount),
    primaryLabel: 'Открыть QC',
    onPrimary: () => openQcIssue(info.issue_id, opts?.returnTo, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Закрыто заказчиком → путь к closeout / документам */
export function alertWarrantyClosed(role: OsRole) {
  showActionConfirm({
    title: 'Гарантия закрыта',
    message: 'Если остальные гейты готовы — завершите объект в Документах.',
    primaryLabel: 'К завершению',
    onPrimary: () => pushOsNav('/documents', undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}
