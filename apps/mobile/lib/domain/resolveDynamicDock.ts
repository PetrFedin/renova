/** Динамическая нижняя панель заказчика — setup vs repair по чеклисту */
import type { ProjectDetail } from '@/lib/api';
import type { DockItemId } from '@/constants/dockBar';
import { DOCK_PRESET_REPAIR, DOCK_PRESET_SETUP } from '@/constants/dockBar';
import type { OsRole } from '@/constants/osSections';
import { buildSetupChecklist, setupChecklistProgress } from './buildSetupChecklist';
import type { ProjectOsSnapshot } from './osTypes';
import { resolveProjectPhase } from './resolveProjectPhase';
import type { DetailLevel } from '@/lib/detailLevel';

export type DockPresetMode = 'setup' | 'repair';

/** Минимальный snap для расчёта dock без полной загрузки OS */
export function minimalSnapFromProject(project: ProjectDetail): Pick<ProjectOsSnapshot, 'isComplete' | 'pendingPayments' | 'schedule'> {
  return {
    isComplete: (project.progress_percent ?? 0) >= 100,
    pendingPayments: project.pending_payments ?? 0,
    schedule: { progressPercent: project.progress_percent ?? 0 },
  };
}

/** Режим preset: настройка объекта или активный ремонт */
export function resolveDockPresetMode(
  project: ProjectDetail,
  snap: Pick<ProjectOsSnapshot, 'isComplete' | 'pendingPayments' | 'schedule'>,
  role: OsRole,
): DockPresetMode | null {
  if (role !== 'customer') return null;
  if (resolveProjectPhase(snap as ProjectOsSnapshot) === 'complete') return null;

  const items = buildSetupChecklist(project, snap as ProjectOsSnapshot, role);
  if (!items.length) return 'repair';

  const progress = setupChecklistProgress(items);
  const hasStages = (project.stages?.length ?? 0) > 0;

  if (progress < 80 || !hasStages) return 'setup';
  return 'repair';
}

export function dockPresetItems(mode: DockPresetMode): DockItemId[] {
  return mode === 'setup' ? [...DOCK_PRESET_SETUP] : [...DOCK_PRESET_REPAIR];
}

/** Dynamic dock только для customer; detailed — ручные prefs */
export function shouldUseDynamicDock(role: OsRole, detailLevel: DetailLevel, phase: ReturnType<typeof resolveProjectPhase>): boolean {
  if (role !== 'customer') return false;
  if (phase === 'complete') return false;
  if (detailLevel === 'detailed') return false;
  return true;
}

export function resolveDynamicDockItems(
  project: ProjectDetail | null,
  snap: Pick<ProjectOsSnapshot, 'isComplete' | 'pendingPayments' | 'schedule'> | null,
  role: OsRole,
  detailLevel: DetailLevel,
): DockItemId[] | null {
  if (!project || !snap) return null;
  const phase = resolveProjectPhase(snap as ProjectOsSnapshot);
  if (!shouldUseDynamicDock(role, detailLevel, phase)) return null;
  const mode = resolveDockPresetMode(project, snap, role);
  if (!mode) return null;
  return dockPresetItems(mode);
}
