/**
 * Готовые словоформы для частых сущностей UI.
 * Использовать через formatCount / pluralizeRu — не копировать строки в компоненты.
 */
import { formatCount, pluralizeRu, type RuPluralForms, type RuPluralTuple } from './ruPlural';

export const RU_NOUN = {
  message: ['сообщение', 'сообщения', 'сообщений'] as const,
  unreadMessage: {
    one: 'непрочитанное сообщение',
    few: 'непрочитанных сообщения',
    many: 'непрочитанных сообщений',
    other: 'непрочитанных сообщения',
  } satisfies RuPluralForms,
  /** Кратко: «1 непрочитанное» / «5 непрочитанных» */
  unread: {
    one: 'непрочитанное',
    few: 'непрочитанных',
    many: 'непрочитанных',
    other: 'непрочитанных',
  } satisfies RuPluralForms,
  task: ['задача', 'задачи', 'задач'] as const,
  document: ['документ', 'документа', 'документов'] as const,
  issue: ['замечание', 'замечания', 'замечаний'] as const,
  payment: ['платёж', 'платежа', 'платежей'] as const,
  /** Счета (оплаты) — «1 счёт / 2 счёта / 5 счетов» */
  invoice: ['счёт', 'счёта', 'счетов'] as const,
  day: ['день', 'дня', 'дней'] as const,
  file: ['файл', 'файла', 'файлов'] as const,
  participant: ['участник', 'участника', 'участников'] as const,
  project: ['объект', 'объекта', 'объектов'] as const,
  dialog: ['диалог', 'диалога', 'диалогов'] as const,
  event: ['событие', 'события', 'событий'] as const,
  risk: ['риск', 'риска', 'рисков'] as const,
} as const;

export function formatUnreadCount(count: unknown): string {
  return formatCount(count, RU_NOUN.unread);
}

export function formatUnreadMessages(count: unknown): string {
  return formatCount(count, RU_NOUN.unreadMessage);
}

export function formatTasks(count: unknown): string {
  return formatCount(count, RU_NOUN.task);
}

export function formatDocuments(count: unknown): string {
  return formatCount(count, RU_NOUN.document);
}

export function formatIssues(count: unknown): string {
  return formatCount(count, RU_NOUN.issue);
}

export function formatPayments(count: unknown): string {
  return formatCount(count, RU_NOUN.payment);
}

export function formatInvoices(count: unknown): string {
  return formatCount(count, RU_NOUN.invoice);
}

export function formatDays(count: unknown): string {
  return formatCount(count, RU_NOUN.day);
}

export function formatFiles(count: unknown): string {
  return formatCount(count, RU_NOUN.file);
}

export function formatParticipants(count: unknown): string {
  return formatCount(count, RU_NOUN.participant);
}

export function formatProjects(count: unknown): string {
  return formatCount(count, RU_NOUN.project);
}

export function formatDialogs(count: unknown): string {
  return formatCount(count, RU_NOUN.dialog);
}

export function nounRu(count: unknown, forms: RuPluralTuple | RuPluralForms): string {
  return pluralizeRu(count, forms);
}
