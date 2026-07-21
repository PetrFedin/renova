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
  idempotent_replay?: boolean;
  duplicate_hint?: string | null;
};

/** Сообщение после создания тикета */
export function warrantyCreatedMessage(info: WarrantyCreateInfo, openCount?: number): string {
  const sla = info.sla_days || 14;
  const post = info.post_closeout ? ' (после сдачи)' : '';
  const open = openCount != null ? ` Открытых: ${openCount}.` : '';
  const doc = info.document_id ? ` Документ: ${info.document_id.slice(0, 8)}…` : '';
  const id = info.issue_id ? ` ID: ${info.issue_id.slice(0, 8)}…` : '';
  const replay = info.idempotent_replay ? ' (повтор запроса — дубль не создан)' : '';
  return `Тикет создан${post}${replay}. SLA ${sla} дн.${open}${id}${doc}`;
}

/** 409 conflict — понятное сообщение без PII */
export function alertWarrantyConflict(message?: string) {
  Alert.alert(
    'Конфликт запроса',
    message
      || 'Этот запрос уже использовался с другим текстом обращения. Создайте новое обращение (будет новый ключ).',
  );
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
