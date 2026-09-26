/**
 * LEGACY-RETAINED #399: historical setup/repair dock preset resolver.
 * Production `OsDockBar` no longer applies these presets automatically because
 * primary navigation must not rearrange itself as project context changes.
 * Kept for migration/audit evidence until removal has full reference proof.
 */
import type { ProjectDetail } from '@/lib/api';
import type { DockItemId } from '@/constants/dockBar';
import { DOCK_PRESET_REPAIR, DOCK_PRESET_SETUP } from '@/constants/dockBar';
import type { OsRole } from '@/constants/osSections';
import { buildSetupChecklist, setupChecklistProgress } from './buildSetupChecklist';
import type { ProjectOsSnapshot } from './osTypes';
import { resolveProjectPhase } from './resolveProjectPhase';
import type { DetailLevel } from '@/lib/detailLevel';

export type DockPresetMode = 'setup' | 'repair';

/** Минимальный snap для расчёта исторического preset без полной загрузки OS */
export function minimalSnapFromProject(project: ProjectDetail): Pick<ProjectOsSnapshot, 'isComplete' | 'pendingPayments' | 'schedule'> {
  return {
    isComplete: (project.progress_percent ?? 0) >= 100,
    pendingPayments: project.pending_payments ?? 0,
    // delayDays неизвестен без полного OS-snapshot — 0 = «нет данных о просрочке»
    schedule: { progressPercent: project.progress_percent ?? 0, delayDays: 0 },
  };
}

/** Исторический режим preset: настройка объекта или активный ремонт. */
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

/** Historical preset membership retained for migration/audit only. */
export function dockPresetItems(mode: DockPresetMode): readonly DockItemId[] {
  return mode === 'setup' ? DOCK_PRESET_SETUP : DOCK_PRESET_REPAIR;
}

/** Historical eligibility policy retained for migration/audit only. */
export function shouldUseDynamicDock(role: OsRole, detailLevel: DetailLevel, phase: ReturnType<typeof resolveProjectPhase>): boolean {
  if (role !== 'customer') return false;
  if (phase === 'complete') return false;
  if (detailLevel === 'detailed') return false;
  return true;
}

/** Historical resolver; production Dock no longer consumes this automatically. */
export function resolveDynamicDockItems(
  project: ProjectDetail | null,
  snap: Pick<ProjectOsSnapshot, 'isComplete' | 'pendingPayments' | 'schedule'> | null,
  role: OsRole,
  detailLevel: DetailLevel,
): readonly DockItemId[] | null {
  if (!project || !snap) return null;
  const phase = resolveProjectPhase(snap as ProjectOsSnapshot);
  if (!shouldUseDynamicDock(role, detailLevel, phase)) return null;
  const mode = resolveDockPresetMode(project, snap, role);
  if (!mode) return null;
  return dockPresetItems(mode);
}
