/** Единый календарь — отдельная вкладка dock/меню (не hub «Ремонт») */
import { UnifiedScheduleView } from '@/components/screens/schedule/UnifiedScheduleView';
import { ProjectScopeLoader } from '@/components/renova/ProjectScopeLoader';
import type { OsRole } from '@/constants/osSections';

export function OsCalendarScreen({ role }: { role: OsRole }) {
  return (
    <ProjectScopeLoader role={role} hint="Выберите объект — календарь покажет его график работ.">
      <UnifiedScheduleView role={role} />
    </ProjectScopeLoader>
  );
}
