/** Группировка и строки сравнения для портфеля и picker */
import type { ProjectSummary } from '@/lib/api';
import { formatProjectPhaseLabel } from '@/lib/domain/formatProjectPhaseLabel';

export type PortfolioProjectRow = {
  id: string;
  name: string;
  planned: number;
  spent: number;
  variance: number;
  variancePct: number;
  progressPercent: number;
  status: 'under' | 'over' | 'on_track';
  phaseLabel: string;
};

export function partitionPortfolioProjects(
  projects: ProjectSummary[],
  pendingById: Record<string, number> = {},
): { inProgress: ProjectSummary[]; completed: ProjectSummary[] } {
  const inProgress: ProjectSummary[] = [];
  const completed: ProjectSummary[] = [];
  for (const p of projects) {
    const phase = formatProjectPhaseLabel(p, pendingById[p.id]);
    if (phase === 'Завершён') completed.push(p);
    else inProgress.push(p);
  }
  inProgress.sort((a, b) => b.progress_percent - a.progress_percent || a.name.localeCompare(b.name, 'ru'));
  completed.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { inProgress, completed };
}

export function buildPortfolioProjectRows(
  projects: Pick<ProjectSummary, 'id' | 'name' | 'budget_planned' | 'budget_spent' | 'progress_percent' | 'pending_payments'>[],
  pendingById: Record<string, number> = {},
): PortfolioProjectRow[] {
  return projects.map((p) => {
    const planned = p.budget_planned || 0;
    const spent = p.budget_spent || 0;
    const variance = spent - planned;
    const variancePct = planned > 0 ? Math.round((variance / planned) * 100) : 0;
    let status: PortfolioProjectRow['status'] = 'on_track';
    if (variancePct > 2) status = 'over';
    else if (variancePct < -2) status = 'under';
    return {
      id: p.id,
      name: p.name,
      planned,
      spent,
      variance,
      variancePct,
      progressPercent: p.progress_percent || 0,
      status,
      phaseLabel: formatProjectPhaseLabel(p as ProjectSummary, pendingById[p.id]),
    };
  });
}
