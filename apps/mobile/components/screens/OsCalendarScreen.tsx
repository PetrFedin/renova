/** W71: единый hub «Сроки» — calendar tab = UnifiedScheduleView (work-schedule redirect сюда). */
import { View } from 'react-native';
import { UnifiedScheduleView } from '@/components/screens/schedule/UnifiedScheduleView';
import { ProjectScopeLoader } from '@/components/renova/ProjectScopeLoader';
import { TechnicalSupervisionScheduleReview } from '@/components/renova/TechnicalSupervisionScheduleReview';
import type { OsRole } from '@/constants/osSections';

export function OsCalendarScreen({ role }: { role: OsRole }) {
  return (
    <ProjectScopeLoader role={role}>
      <View style={{ flex: 1 }}>
        <TechnicalSupervisionScheduleReview />
        <UnifiedScheduleView role={role} />
      </View>
    </ProjectScopeLoader>
  );
}
