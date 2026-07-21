/** Archive/trash/restore — только владелец объекта (не гость и не read-only). */
import type { ProjectSummary, UserRole } from '@/lib/api';

export function canManageProjectLifecycle(
  project: ProjectSummary,
  role: UserRole | undefined,
  readOnly?: boolean,
): boolean {
  if (role !== 'customer' || readOnly) return false;
  // Старый backend без access_mode — считаем владельцем; guest/shared → access_mode !== owner
  return !project.access_mode || project.access_mode === 'owner';
}

export function formatLifecycleActionError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return 'Не удалось выполнить действие';
}
