/** Единый календарь — отдельная вкладка dock/меню (не hub «Ремонт») */
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
