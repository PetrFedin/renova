import type { ProjectDetail, ProjectSummary } from '@/lib/api';

type ProjectLike = Pick<
  ProjectSummary | ProjectDetail,
  'operational_persona' | 'capabilities' | 'access_mode' | 'technical_capabilities'
>;

const LEGACY_TECHNICAL_MAP: Record<string, string> = {
  project_read: 'project.read',
  communication: 'communication.write',
  quality_issue_write: 'quality.issue',
  quality_review: 'quality.review',
  schedule_review: 'schedule.review',
};

export function operationalPersona(project?: ProjectLike | null) {
  if (project?.operational_persona) return project.operational_persona;
  if (project?.access_mode === 'supervisor') return 'supervisor';
  if (project?.access_mode === 'guest') return 'guest';
  if (project?.access_mode === 'participant') return 'participant';
  if (project?.access_mode === 'owner') return 'owner';
  if (project?.access_mode === 'contractor') return 'lead';
  return 'guest';
}

export function projectCapabilitySet(project?: ProjectLike | null): Set<string> {
  if (project?.capabilities?.length) return new Set(project.capabilities);
  const legacy = new Set<string>();
  for (const capability of project?.technical_capabilities || []) {
    const mapped = LEGACY_TECHNICAL_MAP[capability];
    if (mapped) legacy.add(mapped);
  }
  return legacy;
}

export function hasProjectCapability(
  project: ProjectLike | null | undefined,
  capability: string,
): boolean {
  return projectCapabilitySet(project).has(capability);
}
