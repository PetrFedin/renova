/** W126: гарантия post-closeout → QC / closeout SoT (Buildertrend heritage) */
import { Alert } from 'react-native';
import { openQcIssue } from '@/lib/qcNav';
import { pushOsNav } from '@/lib/pushOsNav';
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
  Alert.alert('Гарантия', warrantyCreatedMessage(info, opts?.openCount), [
    { text: 'OK' },
    {
      text: 'Открыть QC',
      onPress: () => openQcIssue(info.issue_id, opts?.returnTo, role),
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
