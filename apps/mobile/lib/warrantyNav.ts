/** W126: гарантия post-closeout → QC / closeout SoT (Buildertrend heritage) */
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { warrantyRoute } from '@/lib/navigation/navigationPolicy';
import { showActionConfirm } from '@/lib/actionConfirmBus';

export type WarrantyCreateInfo = {
  issue_id?: string;
  claim_id?: string;
  document_id?: string;
  post_closeout?: boolean;
  sla_days?: number;
};

export type WarrantyNavigationParams = {
  issueId?: string;
  claimId?: string;
  documentId?: string;
  source: 'document';
};

/** Канонический контекст навигации без смешения идентификаторов сущностей. */
export function warrantyNavigationParams(info: WarrantyCreateInfo): WarrantyNavigationParams {
  return {
    ...(info.issue_id ? { issueId: info.issue_id } : {}),
    ...(info.claim_id ? { claimId: info.claim_id } : {}),
    ...(info.document_id ? { documentId: info.document_id } : {}),
    source: 'document',
  };
}

/** Сообщение после создания тикета */
export function warrantyCreatedMessage(info: WarrantyCreateInfo, openCount?: number): string {
  const sla = info.sla_days || 14;
  const post = info.post_closeout ? ' (после сдачи)' : '';
  const open = openCount != null ? ` Открытых: ${openCount}.` : '';
  const doc = info.document_id ? ` Документ: ${info.document_id.slice(0, 8)}…` : '';
  return `Тикет создан${post}. SLA ${sla} дн.${open}${doc}`;
}

/** Создано → Documents/Warranty для customer, action-oriented QC для contractor. */
export function alertWarrantyCreated(
  role: OsRole,
  info: WarrantyCreateInfo,
  opts?: { openCount?: number; returnTo?: string },
) {
  showActionConfirm({
    title: 'Гарантия',
    message: warrantyCreatedMessage(info, opts?.openCount),
    primaryLabel: role === 'contractor' ? 'Открыть контроль' : 'Открыть обращение',
    onPrimary: () => pushOsNav(
      warrantyRoute(role, warrantyNavigationParams(info)),
      opts?.returnTo,
      role,
    ),
    secondaryLabel: 'Позже',
  });
}

/** Закрыто заказчиком → путь к closeout / документам */
export function alertWarrantyClosed(role: OsRole) {
  showActionConfirm({
    title: 'Гарантия закрыта',
    message: 'Если остальные гейты готовы — можно завершить объект в Документах.',
    primaryLabel: 'К завершению',
    onPrimary: () => pushOsNav('/documents', undefined, role),
    secondaryLabel: 'Позже',
  });
}
