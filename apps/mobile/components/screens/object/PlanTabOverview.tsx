/** Обзор вкладки «План» — как связаны разделы и текущий статус */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import {
  calendarTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { useNavFromHere } from '@/lib/navigation';
import { formatScheduleRange } from '@/lib/formatScheduleDate';
import type { ProjectDetail } from '@/lib/api';
import { api } from '@/lib/api';

type Props = {
  role: OsRole;
  project: ProjectDetail;
  userId: string;
};

export function PlanTabOverview({ role, project, userId }: Props) {
  const nav = useNavFromHere();
  const [floorCount, setFloorCount] = useState(0);
  const [designCount, setDesignCount] = useState(0);
  const [designPending, setDesignPending] = useState(0);

  useEffect(() => {
    api.listFloorPlans(userId, project.id).then((plans) => setFloorCount(plans.length)).catch(() => {});
    api
      .listDesignPackages(userId, project.id)
      .then((items) => {
        setDesignCount(items.length);
        setDesignPending(items.filter((d) => d.status === 'pending').length);
      })
      .catch(() => {});
  }, [userId, project.id]);

  const stagesCount = project.stages?.length || 0;
  const roomsCount = project.rooms?.length || project.rooms_count || 0;
  const dates = formatScheduleRange(project.planned_start_date, project.planned_end_date);

  return (
    <View style={s.wrap}>
      <View style={s.hero}>
        <Text style={s.heroTitle}>План объекта</Text>
        <Text style={s.heroMeta}>
          {dates} · {roomsCount} комн. · {stagesCount} этапов
        </Text>
      </View>

      <View style={s.flow}>
        <Text style={s.flowTitle}>Как это работает</Text>
        <Text style={s.flowLine}>① Профиль — общие сроки и тип ремонта</Text>
        <Text style={s.flowLine}>② План (здесь) — чертёж, дизайн, обзор графика</Text>
        <Text style={s.flowLine}>③ Ремонт — выполнение этапов и приёмка</Text>
        <Text style={s.flowLine}>④ Календарь — полное расписание по датам</Text>
      </View>

      <View style={s.statusRow}>
        <StatusChip
          label="План этажа"
          value={floorCount ? `${floorCount} загружено` : 'не загружен'}
          warn={!floorCount}
        />
        <StatusChip
          label="Дизайн"
          value={
            designPending
              ? `${designPending} на согласовании`
              : designCount
                ? `${designCount} версий`
                : 'нет пакетов'
          }
          warn={designCount === 0}
        />
        <StatusChip label="Этапы" value={stagesCount ? `${stagesCount} в графике` : 'не настроены'} warn={!stagesCount} />
      </View>

      <View style={s.links}>
        <LinkBtn label="→ Профиль" onPress={() => pushOsNav(objectTabRoute(role, 'profile'), nav.from)} />
        <LinkBtn label="→ Ремонт" onPress={() => pushOsNav(repairTabRoute(role, 'works'), nav.from)} />
        <LinkBtn label="→ Календарь" onPress={() => pushOsNav(calendarTabRoute(role), nav.from)} />
      </View>
    </View>
  );
}

function StatusChip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={[s.chip, warn && s.chipWarn]}>
      <Text style={s.chipLabel}>{label}</Text>
      <Text style={[s.chipVal, warn && s.chipValWarn]}>{value}</Text>
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
  hero: { ...card, paddingVertical: 12, backgroundColor: '#F0F9FF' },
  heroTitle: { fontSize: 16, fontWeight: '800', color: RenovaTheme.colors.text },
  heroMeta: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 18 },
  flow: { ...card, paddingVertical: 10, backgroundColor: '#F8FAFC' },
  flowTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  flowLine: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1,
    minWidth: '30%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  chipWarn: { borderColor: '#FCD34D', backgroundColor: '#FFFBEB' },
  chipLabel: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  chipVal: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.text, marginTop: 2 },
  chipValWarn: { color: '#92400E' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  linkBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.primary,
    backgroundColor: RenovaTheme.colors.surface,
  },
  linkT: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary },
});
