/** Права заказчика vs исполнителя — единая матрица для UI */
import type { OsRole } from '@/constants/osSections';

export type RoleContext = {
  role: OsRole;
  readOnly?: boolean;
  accessMode?: 'owner' | 'contractor' | 'guest';
};

export function isProjectOwner(ctx: RoleContext): boolean {
  return ctx.role === 'customer' && !ctx.readOnly;
}

export function canEditProjectProfile(ctx: RoleContext): boolean {
  return isProjectOwner(ctx);
}

export function canEditCustomerBudget(ctx: RoleContext): boolean {
  return isProjectOwner(ctx);
}

export function canManageGuests(ctx: RoleContext): boolean {
  return isProjectOwner(ctx);
}

export function canLinkContractor(ctx: RoleContext): boolean {
  return isProjectOwner(ctx);
}

export function canCreateProject(ctx: RoleContext): boolean {
  return ctx.role === 'customer' && !ctx.readOnly;
}

export function canConfirmPayments(ctx: RoleContext): boolean {
  return isProjectOwner(ctx);
}

export function canPublishWorks(ctx: RoleContext): boolean {
  return ctx.role === 'contractor' && !ctx.readOnly;
}

export function canEditEstimateLines(ctx: RoleContext): boolean {
  return ctx.role === 'contractor' && !ctx.readOnly;
}

export function homeHeroLabel(ctx: RoleContext): string {
  if (ctx.role === 'contractor') return 'Задачи по объекту';
  return 'Сделать сейчас';
}

export function objectProfileHint(ctx: RoleContext): string {
  if (ctx.role === 'contractor') {
    return 'Исполнитель: уточняйте параметры с заказчиком. Сохраняются только согласованные правки.';
  }
  return 'Заполните пробелы и нажмите «Сохранить».';
}

export function roleScopeLabel(ctx: RoleContext): string {
  if (ctx.readOnly) return 'Гость · только просмотр';
  if (ctx.role === 'contractor') return 'Исполнитель · работы и смета';
  return 'Заказчик · объект и оплаты';
}
