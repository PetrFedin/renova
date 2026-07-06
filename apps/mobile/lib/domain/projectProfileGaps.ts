/** Пробелы в профиле объекта — для подсказки на главной */
import type { ProjectDetail } from '@/lib/api';

export type ProjectProfileGap = 'address' | 'dates';

export function getProjectProfileGaps(project: ProjectDetail): ProjectProfileGap[] {
  const gaps: ProjectProfileGap[] = [];
  if (!project.address?.trim()) gaps.push('address');
  if (!project.planned_start_date || !project.planned_end_date) gaps.push('dates');
  return gaps;
}

export function formatProfileGapLabel(gaps: ProjectProfileGap[]): string {
  const parts: string[] = [];
  if (gaps.includes('address')) parts.push('адрес');
  if (gaps.includes('dates')) parts.push('сроки');
  return parts.join(' и ');
}
