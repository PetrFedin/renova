/** W126: гарантия post-closeout → QC / closeout SoT (Buildertrend heritage) */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { warrantyRoute } from '@/lib/navigation/navigationPolicy';

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

/** Создано → Documents/Warranty для customer, action-oriented QC для contractor. */
export function alertWarrantyCreated(
  role: OsRole,
  info: WarrantyCreateInfo,
  opts?: { openCount?: number; returnTo?: string },
) {
  Alert.alert('Гарантия', warrantyCreatedMessage(info, opts?.openCount), [
    { text: 'OK' },
    {
      text: role === 'contractor' ? 'Открыть контроль' : 'Открыть обращение',
      onPress: () => pushOsNav(
        warrantyRoute(role, {
          ...(info.issue_id ? { issueId: info.issue_id } : {}),
          ...(info.document_id ? { claimId: info.document_id } : {}),
          source: 'document',
        }),
        opts?.returnTo,
        role,
      ),
    },
  ]);
}

/** Закрыто заказчиком → путь к closeout / документам */
export function alertWarrantyClosed(role: OsRole) {
  Alert.alert(
    'Гарантия закрыта',
    'Если остальные гейты готовы — можно завершить объект в Документах.',
    [
      { text: 'OK' },
      {
        text: 'К завершению',
        onPress: () => pushOsNav('/documents', undefined, role),
      },
    ],
  );
}
