/** Чеклист настройки объекта — прогресс из данных проекта */
import type { ProjectDetail } from '@/lib/api';
import type { ProjectOsSnapshot } from '@/lib/domain/osTypes';
import { resolveProjectPhase } from '@/lib/domain/resolveProjectPhase';
import { getProjectProfileGaps } from '@/lib/domain/projectProfileGaps';
import {
  customerProfileTabHref,
  objectTabHref,
  repairTabHref,
  tabsHref,
  type OsRole,
} from '@/constants/osSections';

export type SetupChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  href: string;
  priority: number;
};

export function buildSetupChecklist(
  project: ProjectDetail,
  snap: ProjectOsSnapshot,
  role: OsRole,
): SetupChecklistItem[] {
  if (role !== 'customer') return [];
  if (resolveProjectPhase(snap) !== 'active') return [];

  const rooms = project.rooms?.length ?? 0;
  const estimateLines = project.estimate_lines?.length ?? 0;
  const stages = project.stages?.length ?? 0;
  const profileDone = getProjectProfileGaps(project).length === 0;
  const budgetTracked =
    (project.customer_budget ?? 0) > 0
    || (project.budget_planned ?? 0) > 0
    || snap.schedule?.progressPercent != null;

  return [
    {
      id: 'object',
      label: 'Объект создан',
      done: true,
      href: tabsHref(role, 'object', 'profile'),
      priority: 1,
    },
    {
      id: 'profile',
      label: 'Данные объекта',
      done: profileDone,
      href: objectTabHref(role, 'profile'),
      priority: 2,
    },
    {
      id: 'rooms',
      label: 'Комнаты',
      done: rooms > 0,
      href: objectTabHref(role, 'rooms'),
      priority: 3,
    },
    {
      id: 'estimate',
      label: 'Смета',
      done: estimateLines > 0,
      href: objectTabHref(role, 'estimate'),
      priority: 4,
    },
    {
      id: 'contractor',
      label: 'Исполнитель',
      done: !!project.contractor_id,
      href: customerProfileTabHref(role, 'contractor'),
      priority: 5,
    },
    {
      id: 'stages',
      label: 'Этапы',
      done: stages > 0,
      href: repairTabHref(role, 'works'),
      priority: 6,
    },
    {
      id: 'budget',
      label: 'Бюджет под контролем',
      done: budgetTracked,
      href: tabsHref(role, 'budget', 'summary'),
      priority: 7,
    },
  ].sort((a, b) => a.priority - b.priority);
}

export function setupChecklistProgress(items: SetupChecklistItem[]): number {
  if (!items.length) return 100;
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

export function nextSetupItem(items: SetupChecklistItem[]): SetupChecklistItem | undefined {
  return items.find((i) => !i.done && i.id !== 'object');
}

export function shouldShowSetupChecklist(
  items: SetupChecklistItem[],
  dismissed: boolean,
): boolean {
  if (dismissed || !items.length) return false;
  return setupChecklistProgress(items) < 80;
}
