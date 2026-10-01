/**
 * Чистая логика экранов «Бригада» (профиль исполнителя, QR): без react-native.
 * MKT-013/021/022/023/035.
 */
import { normalizePhoneInput } from './formatPhone';

export const TEAM_ROLES = [
  { id: 'member', label: 'Рабочий', hint: 'Этапы, чеки, снабжение' },
  { id: 'foreman', label: 'Прораб', hint: 'Координация на объекте' },
  { id: 'viewer', label: 'Наблюдатель', hint: 'Только просмотр' },
] as const;

export type TeamRoleId = (typeof TEAM_ROLES)[number]['id'];

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  member: 'Рабочий',
  foreman: 'Прораб',
  viewer: 'Наблюдатель',
};

export function teamRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Роль, которую можно назначить участнику: owner назначить нельзя (сервер вернёт 403). */
export function isAssignableTeamRole(role: unknown): role is TeamRoleId {
  return TEAM_ROLES.some((r) => r.id === role);
}

/** Роль приглашения: неизвестное значение сводится к безопасному «member». */
export function resolveInviteRole(role: unknown): TeamRoleId {
  return isAssignableTeamRole(role) ? role : 'member';
}

/** Канонический номер для API или null, если ввод не похож на телефон (MKT-037). */
export function canonicalInvitePhone(raw: string): string | null {
  const normalized = normalizePhoneInput(raw || '');
  return /^\+\d{8,15}$/.test(normalized) ? normalized : null;
}

export type TeamLike = {
  id?: string;
  name?: string;
  owner_id?: string;
  members?: { user_id: string; phone?: string; role: string }[];
};

/** Результат загрузки команды: «команды нет» (null) и «не удалось загрузить» — разные состояния (MKT-035). */
export type TeamLoadOutcome =
  | { kind: 'loaded'; team: TeamLike | null }
  | { kind: 'failed' };

export type TeamView =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'none' }
  | { state: 'ready'; team: TeamLike };

export function resolveTeamView(outcome: TeamLoadOutcome | null, previous?: TeamLike | null): TeamView {
  if (outcome === null) return { state: 'loading' };
  if (outcome.kind === 'failed') {
    // Уже загруженную команду при сбое обновления не стираем.
    return previous ? { state: 'ready', team: previous } : { state: 'error' };
  }
  return outcome.team ? { state: 'ready', team: outcome.team } : { state: 'none' };
}

export type QrScreenMode = 'loading' | 'error' | 'no-team' | 'owner' | 'member';

/**
 * Экран «Бригада QR»: открытие только читает. Ссылку создаёт владелец явным действием;
 * «создать бригаду» предлагаем только тому, у кого её действительно нет.
 */
export function qrScreenMode(view: TeamView, userId: string | undefined): QrScreenMode {
  if (view.state === 'loading') return 'loading';
  if (view.state === 'error') return 'error';
  if (view.state === 'none') return 'no-team';
  return view.team.owner_id && view.team.owner_id === userId ? 'owner' : 'member';
}

export function canManageTeam(team: TeamLike | null | undefined, userId: string | undefined): boolean {
  return Boolean(team && userId && team.owner_id === userId);
}

/** Можно ли владельцу менять роль/убирать этого участника. */
export function canEditMember(
  team: TeamLike | null | undefined,
  userId: string | undefined,
  member: { user_id: string; role: string },
): boolean {
  return canManageTeam(team, userId) && member.user_id !== userId && member.role !== 'owner';
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  invalid_phone: 'Проверьте номер телефона',
  invalid_team_role: 'Недопустимая роль',
  already_member: 'Этот исполнитель уже в бригаде',
  team_not_found: 'Сначала создайте бригаду',
  team_owner_only: 'Это действие доступно только владельцу бригады',
  team_role_change_forbidden: 'Роль этого участника изменить нельзя',
  invitation_not_found: 'Приглашение уже недействительно',
  sms_phone_limit: 'На этот номер уже отправлено максимум сообщений за сутки',
  sms_user_limit: 'Достигнут суточный лимит SMS-приглашений',
  invite_user_limit: 'Достигнут суточный лимит приглашений',
  sms_delivery_failed: 'SMS не отправлено, попробуйте позже',
};

/** Понятный текст ошибки команды по коду сервера (иначе — сообщение самой ошибки). */
export function teamErrorMessage(error: unknown, fallback = 'Не удалось выполнить действие'): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    if (typeof e.code === 'string' && ERROR_CODE_MESSAGES[e.code]) return ERROR_CODE_MESSAGES[e.code];
    if (typeof e.message === 'string' && e.message.trim() && !/^[a-z][a-z0-9_]*$/.test(e.message.trim())
      && !e.message.startsWith('Ошибка сервера')) return e.message.trim();
  }
  return fallback;
}

/** MKT-012: подпись действующего приглашения владельца (без токена ссылки). */
export function ownerInviteLabel(invite: { role: string; kind: 'personal' | 'link' | string; expires_at: string }): string {
  const kind = invite.kind === 'personal' ? 'Личное приглашение' : 'Ссылка / QR';
  const d = new Date(invite.expires_at);
  const until = Number.isNaN(d.getTime()) ? '' : ` · до ${d.toLocaleDateString('ru-RU')}`;
  return `${kind} · роль: ${teamRoleLabel(invite.role)}${until}`;
}
