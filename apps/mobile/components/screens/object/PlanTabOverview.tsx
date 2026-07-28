/** Обзор вкладки «План» — 2 строки meta + CTA (Clarity A: без flow/chip-шума) */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import {
  calendarTabRoute,
  planPunchRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { useNavFromHere } from '@/lib/navigation';
import { formatScheduleRange } from '@/lib/formatScheduleDate';
import type { ProjectDetail } from '@/lib/api';
import { api } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportCatch } from '@/lib/reportError';

type Props = {
  role: OsRole;
  project: ProjectDetail;
  userId: string;
};

export function PlanTabOverview({ role, project, userId }: Props) {
  const nav = useNavFromHere();
  const [floorCount, setFloorCount] = useState(0);
  const [designPending, setDesignPending] = useState(0);

  const reload = useCallback(() => {
    api.listFloorPlans(userId, project.id).then((plans) => setFloorCount(plans.length)).catch(reportCatch('components.screens.object.PlanTabOverview.1'));
    api
      .listDesignPackages(userId, project.id)
      .then((items) => setDesignPending(items.filter((d) => d.status === 'pending').length))
      .catch(reportCatch('components.screens.object.PlanTabOverview.2'));
  }, [userId, project.id]);
  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  const stagesCount = project.stages?.length || 0;
  const roomsCount = project.rooms?.length || project.rooms_count || 0;
  const dates = formatScheduleRange(project.planned_start_date, project.planned_end_date);
  const planStatus = floorCount
    ? designPending
      ? `план есть · дизайн на согласовании (${designPending})`
      : 'план загружен'
    : 'план этажа ещё не загружен';

  return (
    <View style={s.wrap}>
      <View style={s.hero}>
        <Text style={s.heroTitle}>План объекта</Text>
        <Text style={s.heroMeta}>
          {dates} · {roomsCount} комн. · {stagesCount} этапов
        </Text>
        <Text style={s.heroStatus}>{planStatus}</Text>
      </View>

      <View style={s.links}>
        {floorCount > 0 ? (
          <LinkBtn
            label="→ Сфоткать дефект на плане"
            onPress={() => pushOsNav(planPunchRoute(role), nav.from)}
          />
        ) : null}
        <LinkBtn label="→ Календарь" onPress={() => pushOsNav(calendarTabRoute(role), nav.from)} />
        <LinkBtn label="→ Ремонт" onPress={() => pushOsNav(repairTabRoute(role, 'works'), nav.from)} />
      </View>
    </View>
  );
}

function LinkBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={s.linkBtn} onPress={onPress}>
      <Text style={s.linkT}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 14, gap: 10 },
  // Clarity T: metricCell вместо тяжёлого info-card
  hero: {
    ...listRowStyles.metricCell,
    alignItems: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: RenovaTheme.colors.infoBg,
  },
  heroTitle: { ...screenTypography.listTitle, fontSize: 16 },
  heroMeta: { ...screenTypography.listMeta, marginTop: 4, lineHeight: 18 },
  heroStatus: { ...screenTypography.listMeta, marginTop: 6, lineHeight: 16 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  linkBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.primary,
    backgroundColor: RenovaTheme.colors.surface,
  },
  linkT: { ...screenTypography.listLink, marginTop: 0 },
});
