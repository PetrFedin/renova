/** Человекочитаемые подписи offline-задач */
import type { OfflineJob } from '@/lib/offlineQueue';

type LabelRule = { method: string; re: RegExp; label: string };

const ID = '[^/]+';
/** Путь без query и без префикса `/api/v1/projects/:id` (если он есть). */
function normalizeJobPath(path: string): { path: string; scoped: boolean } {
  const noQuery = path.split('?')[0].replace(/\/+$/, '');
  const m = noQuery.match(/^\/api\/v1\/projects\/[^/]+(\/.*)?$/);
  if (m) return { path: m[1] || '/', scoped: true };
  return { path: noQuery.replace(/^\/api\/v1/, ''), scoped: false };
}

const rule = (method: string, tail: string, label: string): LabelRule => ({
  method,
  re: new RegExp(`^${tail}$`),
  label,
});

/**
 * CMP-021: точная сопоставлялка «метод + шаблон пути». Подстрочные проверки
 * приписывали «Сдача этапа» любым `/submit` (материалы, дизайн, график).
 * Порядок не важен: шаблоны якорные и не пересекаются.
 */
const RULES: LabelRule[] = [
  rule('POST', `/stages/${ID}/comments`, 'Комментарий этапа'),
  rule('POST', `/stages/${ID}/photos`, 'Фото этапа'),
  rule('POST', `/stages/${ID}/checklist/toggle`, 'Пункт чек-листа'),
  rule('POST', `/stages/${ID}/start`, 'Начало этапа'),
  rule('POST', `/stages/${ID}/ready`, 'Этап готов к проверке'),
  rule('POST', `/stages/${ID}/submit`, 'Сдача этапа'),
  rule('POST', `/stages/${ID}/reject`, 'Отклонение этапа'),
  rule('POST', `/stages/${ID}/accept`, 'Приёмка этапа'),
  rule('PATCH', `/stages/${ID}/rooms`, 'Комнаты этапа'),
  rule('PATCH', `/stages/${ID}/depends`, 'Зависимость этапа'),
  rule('PATCH', `/stages/${ID}/work-type`, 'Тип работ этапа'),
  rule('POST', `/stages`, 'Новый этап'),
  rule('POST', `/rooms`, 'Новая комната'),
  rule('PATCH', `/rooms/${ID}`, 'Изменение комнаты'),
  rule('POST', `/room-change-requests`, 'Запрос изменения комнаты'),
  rule('POST', `/room-change-requests/${ID}/approve`, 'Согласование изменения комнаты'),
  rule('POST', `/room-change-requests/${ID}/reject`, 'Отклонение изменения комнаты'),
  rule('POST', `/chats`, 'Новый чат'),
  rule('POST', `/chats/${ID}/messages`, 'Сообщение чата'),
  rule('POST', `/chats/${ID}/messages/${ID}/(confirm|react|task|pin)`, 'Действие с сообщением чата'),
  rule('POST', `/chats/${ID}/(read|state|invoice)`, 'Действие в чате'),
  rule('POST', `/receipts/manual`, 'Расход без чека'),
  rule('POST', `/receipts/scan`, 'Чек'),
  rule('POST', `/receipts`, 'Чек'),
  rule('(PATCH|DELETE)', `/receipts/${ID}`, 'Изменение чека'),
  rule('(PATCH|DELETE)', `/os/expenses/${ID}`, 'Изменение расхода'),
  rule('POST', `/work-acceptances`, 'Запрос приёмки'),
  rule('POST', `/work-acceptances/${ID}/return`, 'Возврат приёмки'),
  rule('POST', `/work-acceptances/${ID}/accept`, 'Решение по приёмке'),
  rule('POST', `/warranty-claims`, 'Гарантийное обращение'),
  rule('POST', `/warranty-claims/${ID}/close`, 'Закрытие гарантийного обращения'),
  rule('POST', `/issues`, 'Замечание'),
  rule('POST', `/issues/${ID}/(close|transition)`, 'Статус замечания'),
  rule('POST', `/issues/${ID}/escalate`, 'Эскалация спора'),
  rule('POST', `/dependencies/sync`, 'Синхронизация зависимостей'),
  rule('POST', `/payments/${ID}/confirm`, 'Подтверждение оплаты'),
  rule('POST', `/estimate/lines`, 'Строка сметы'),
  rule('(PATCH|DELETE)', `/estimate/lines/${ID}`, 'Изменение строки сметы'),
  rule('POST', `/estimate/(propose-lock|withdraw-lock|reject-lock|lock)`, 'Фиксация сметы'),
  rule('POST', `/change-orders`, 'Допработы'),
  rule('POST', `/change-orders/${ID}/(approve|reject)`, 'Решение по допработам'),
  rule('POST', `/approvals/${ID}/(approve|reject)`, 'Решение по согласованию'),
  rule('POST', `/design-packages`, 'Дизайн-пакет'),
  rule('POST', `/design-packages/${ID}/(submit|approve)`, 'Согласование дизайн-пакета'),
  rule('POST', `/material-picks`, 'Подбор материала'),
  rule('POST', `/material-picks/${ID}/(submit|approve|reject)`, 'Согласование материала'),
  rule('POST', `/material-needs/from-estimate`, 'Потребность в материалах'),
  rule('POST', `/purchases`, 'Закупка'),
  rule('(POST|PATCH)', `/purchases/${ID}/status`, 'Статус закупки'),
  rule('POST', `/waste-orders`, 'Заявка на вывоз мусора'),
  rule('POST', `/waste-orders/${ID}/(request|approve|complete)`, 'Вывоз мусора'),
  rule('POST', `/work-orders`, 'Наряд на работы'),
  rule('(PATCH|POST)', `/work-orders/${ID}(/transition)?`, 'Наряд на работы'),
  rule('POST', `/work-schedules`, 'График работ'),
  rule('POST', `/work-schedules/${ID}/(submit|confirm|reject)`, 'Согласование графика'),
  rule('(PATCH|POST)', `/work-schedules/${ID}/items/${ID}/status`, 'Статус работы в графике'),
  rule('PATCH', `/calendar/stages`, 'Даты этапов'),
  rule('POST', `/calendar/import`, 'Импорт календаря'),
  rule('POST', `/floor-plans`, 'План этажа'),
  rule('POST', `/floor-plans/${ID}/pins`, 'Метка на плане'),
  rule('PATCH', `/floor-plans/${ID}/pins/${ID}`, 'Метка на плане'),
  rule('(POST|PATCH)', `/furniture(/${ID})?`, 'Мебель на плане'),
  rule('POST', `/documents`, 'Документ'),
  rule('POST', `/documents/${ID}/sign`, 'Подпись документа'),
  rule('POST', `/documents/${ID}/archive`, 'Архивация документа'),
  rule('POST', `/scratchpad`, 'Заметка в блокноте'),
  rule('(PATCH|DELETE)', `/scratchpad/${ID}`, 'Изменение заметки'),
  rule('POST', `/selections`, 'Выбор материала'),
  rule('POST', `/selections/${ID}/(propose|approve|reject)`, 'Решение по выбору'),
];

const NOTIFICATION_RULES: LabelRule[] = [
  rule('POST', `/notifications/(${ID}/(read|snooze|snooze-until)|mark-all-read)`, 'Отметка уведомления'),
];

export const OFFLINE_JOB_FALLBACK_LABEL = 'Действие в проекте';

export function offlineJobLabel(j: OfflineJob): string {
  const { path, scoped } = normalizeJobPath(j.path);
  const method = (j.method || '').toUpperCase();
  const rules = scoped ? RULES : NOTIFICATION_RULES;
  for (const r of rules) {
    if (new RegExp(`^${r.method}$`).test(method) && r.re.test(path)) return r.label;
  }
  return OFFLINE_JOB_FALLBACK_LABEL;
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
