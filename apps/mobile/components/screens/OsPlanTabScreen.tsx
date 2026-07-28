/** План объекта — вкладка «Объект → План»: планировка · дизайн (сроки — Календарь) */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { screenLayout } from '@/constants/screenLayout';
import { useRenova } from '@/lib/context/RenovaContext';
import { FloorPlanPanel } from '@/components/renova/FloorPlanPanel';
import { DesignPackageList } from '@/components/renova/DesignPackageList';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { OsHubTabs } from '@/components/renova/os/OsHubTabs';
import { ObjectTabGuide } from '@/components/screens/object/ObjectTabGuide';
import { PlanTabOverview } from '@/components/screens/object/PlanTabOverview';
import { PlanSectionFrame } from '@/components/screens/object/PlanSectionFrame';
import { calendarTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

type PlanSub = 'floor' | 'design';

const SUBTABS = [
  { id: 'floor', label: 'Планировка' },
  { id: 'design', label: 'Дизайн' },
];

const SECTIONS: Record<
  PlanSub,
  { step: string; title: string; hint: string; who: string }
> = {
  floor: {
    step: 'Слой 1',
    title: 'План этажа',
    hint: 'Чертёж или схема с метками комнат. Сверьте с вкладкой «Комнаты».',
    who: 'Загружает подрядчик · метки ведут в карточку комнаты',
  },
  design: {
    step: 'Слой 2',
    title: 'Дизайн-пакеты',
    hint: 'PDF или визуализации отделки — версии и согласование.',
    who: 'Подрядчик загружает · заказчик согласует',
  },
};

export function OsPlanTabScreen({
  role,
  onNextTab,
}: {
  role: OsRole;
  onNextTab?: (tab: ObjectTabId) => void;
}) {
  const { sub: subParam, punch: punchParam } = useLocalSearchParams<{ sub?: string; punch?: string }>();
  const { user, activeProject } = useRenova();
  const [sub, setSub] = useState<PlanSub>('floor');

  useEffect(() => {
    // Investor P2: ?punch=1 всегда открывает слой «Планировка»
    if (punchParam === '1' || punchParam === 'true') {
      setSub('floor');
      return;
    }
    // Legacy sub=schedule → единый SoT «Календарь» (не третий график)
    if (subParam === 'schedule') {
      setSub('floor');
      router.setParams({ sub: 'floor' });
      pushOsNav(calendarTabRoute(role), undefined, role);
      return;
    }
    if (subParam === 'design' || subParam === 'floor') {
      setSub(subParam);
    }
  }, [subParam, punchParam, role]);

  const setSubTab = useCallback((id: PlanSub) => {
    setSub(id);
    router.setParams({ sub: id });
  }, []);

  if (!activeProject || !user) {
    return <ProjectEmptyState role={role} />;
  }

  const section = SECTIONS[sub];

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <ObjectTabGuide tab="plan" role={role} onNextTab={onNextTab} />
      <ReadOnlyBanner />
      <PlanTabOverview role={role} project={activeProject} userId={user.id} />
      <OsHubTabs tabs={SUBTABS} value={sub} onChange={(id) => setSubTab(id as PlanSub)} />
      <PlanSectionFrame {...section}>
        {sub === 'floor' && (
          <FloorPlanPanel
            embedded
            userId={user.id}
            projectId={activeProject.id}
            role={role}
            roomsCount={activeProject.rooms?.length || activeProject.rooms_count || 0}
            onOpenRooms={() => router.setParams({ tab: 'rooms' })}
          />
        )}
        {sub === 'design' && (
          <DesignPackageList embedded userId={user.id} projectId={activeProject.id} role={user.role || role} />
        )}
      </PlanSectionFrame>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
});
