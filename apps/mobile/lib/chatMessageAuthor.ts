/** Автор сообщения (COM-028): «моё» — по id пользователя, подпись — имя, а не только роль. */

type AuthorFields = {
  author_id?: string | null;
  author_name?: string | null;
  author_role?: string | null;
};

export function isMineMessage(message: AuthorFields, user: { id: string; role?: string | null }): boolean {
  // Новый backend отдаёт author_id — сравниваем строго по нему: коллега с той же ролью не «я».
  if (message.author_id) return message.author_id === user.id;
  // Старый backend без author_id: единственное, что есть, — роль.
  return !!message.author_role && message.author_role === user.role;
}

export function authorRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'customer':
      return 'Заказчик';
    case 'contractor':
      return 'Исполнитель';
    case 'supervisor':
      return 'Технадзор';
    default:
      return 'Система';
  }
}

/** «Имя · Роль», если имя известно, иначе только роль. Для своих сообщений — «Вы». */
export function authorLabel(message: AuthorFields, mine: boolean): string {
  const role = authorRoleLabel(message.author_role);
  if (mine) return 'Вы';
  const name = (message.author_name || '').trim();
  return name ? `${name} · ${role}` : role;
}
