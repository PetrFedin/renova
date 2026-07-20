/** W71: единый hub «Сроки» — calendar tab = UnifiedScheduleView (work-schedule redirect сюда). */
import { UnifiedScheduleView } from '@/components/screens/schedule/UnifiedScheduleView';
import { ProjectScopeLoader } from '@/components/renova/ProjectScopeLoader';
import type { OsRole } from '@/constants/osSections';

export function OsCalendarScreen({ role }: { role: OsRole }) {
  return (
    <ProjectScopeLoader role={role}>
      <UnifiedScheduleView role={role} />
    </ProjectScopeLoader>
  );
}
