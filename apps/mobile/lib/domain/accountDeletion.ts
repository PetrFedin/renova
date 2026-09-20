/**
 * Тексты и правила удаления аккаунта.
 *
 * `DELETE /api/v1/auth/me` на сервере есть с самого начала: обезличивает
 * профиль, помечает удалённым и закрывает все сессии, возвращая срок хранения.
 * В приложении входа к нему не было — ни кнопки, ни метода в клиенте.
 *
 * Без такой кнопки приложение с учётными записями не проходит ревью App Store
 * (5.1.1(v): удаление аккаунта должно быть доступно изнутри приложения).
 */

/** Слово, которое нужно ввести, чтобы подтвердить удаление. */
export const DELETE_CONFIRM_WORD = 'УДАЛИТЬ';

export function deleteConfirmMatches(input: string): boolean {
  return input.trim().toUpperCase() === DELETE_CONFIRM_WORD;
}

/** Что именно произойдёт — перечисляем до нажатия, а не после. */
export const DELETE_CONSEQUENCES: string[] = [
  'Имя и телефон в профиле будут обезличены.',
  'Вход по этому номеру перестанет работать, сессии на всех устройствах закроются.',
  'Объекты, сметы и переписка остаются у второй стороны договора — это её документы.',
];

/** Человеческий срок хранения из ответа сервера. */
export function retentionNotice(retentionUntil: string | null | undefined): string {
  if (!retentionUntil) {
    return 'Данные удаляются окончательно после срока хранения.';
  }
  const date = new Date(retentionUntil);
  if (Number.isNaN(date.getTime())) {
    return 'Данные удаляются окончательно после срока хранения.';
  }
  const human = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `Окончательное удаление — после ${human}. До этой даты решение можно отменить только через поддержку.`;
}
