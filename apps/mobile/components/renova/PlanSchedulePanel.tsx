/** График этапов проекта — обзор с переходом в этап, профиль и календарь */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { stageStatusLabel } from '@/constants/labels';
import { calendarTabRoute, objectTabRoute, repairTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { useNavFromHere } from '@/lib/navigation';
import { api, type ProjectPlan } from '@/lib/api';
import { formatScheduleRange, formatScheduleWorkSpan } from '@/lib/formatScheduleDate';

export function PlanSchedulePanel({
  userId,
  projectId,
  role,
  embedded,
  projectDates,
}: {
  userId: string;
  projectId: string;
  role: OsRole;
  embedded?: boolean;
  projectDates?: { start?: string | null; end?: string | null };
}) {
  const nav = useNavFromHere();
  const [plan, setPlan] = useState<ProjectPlan | null>(null);

  useEffect(() => {
    api.getPlan(userId, projectId).then(setPlan).catch(() => {});
  }, [userId, projectId]);

  if (!plan) {
    return (
      <View style={styles.center}>
        <Text style={styles.loading}>Загрузка графика…</Text>
      </View>
    );
  }

  const profileRange = formatScheduleRange(
    projectDates?.start ?? plan.planned_start_date,
    projectDates?.end ?? plan.planned_end_date,
  );

  return (
    <View style={embedded ? styles.embedded : undefined}>
      <View style={styles.syncBox}>
        <Text style={styles.syncTitle}>Сроки проекта (из профиля)</Text>
        <Text style={styles.syncVal}>{profileRange}</Text>
        <Pressable onPress={() => pushOsNav(objectTabRoute(role, 'profile'), nav.from)}>
          <Text style={styles.syncLink}>→ Изменить в профиле</Text>
        </Pressable>
      </View>

      {!plan.stages.length ? (
        <Text style={styles.empty}>
          Этапы появятся после настройки сметы. Ход работ — в разделе «Ремонт».
        </Text>
      ) : (
        plan.stages.map((st, i) => (
          <Pressable key={st.id} style={styles.row} onPress={() => nav.stage(st.id)} accessibilityRole="button">
            <Text style={styles.num}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{st.name}</Text>
              <Text style={styles.dates}>{formatScheduleWorkSpan(st.planned_start, st.planned_end)}</Text>
              <Text style={styles.status}>{stageStatusLabel(st.status)}</Text>
            </View>
            <Text style={styles.link}>→</Text>
          </Pressable>
        ))
      )}

      <View style={styles.footer}>
        <Pressable style={styles.footerBtn} onPress={() => pushOsNav(repairTabRoute(role, 'works'), nav.from)}>
          <Text style={styles.footerT}>→ Ход в «Ремонт»</Text>
        </Pressable>
        <Pressable
          style={styles.footerBtn}
          onPress={() => pushOsNav(calendarTabRoute(role), nav.from)}
        >
          <Text style={styles.footerT}>→ Полный календарь (основной график)</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  embedded: { gap: 8 },
  center: { padding: 24, alignItems: 'center' },
  loading: { color: RenovaTheme.colors.textMuted },
  syncBox: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    marginBottom: 10,
  },
  syncTitle: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  syncVal: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text, marginTop: 4 },
  syncLink: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary, marginTop: 6 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 12, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: RenovaTheme.colors.surface,
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  num: {
    width: 26,
    height: 26,
    lineHeight: 26,
    textAlign: 'center',
    backgroundColor: RenovaTheme.colors.primary,
    color: RenovaTheme.colors.surface,
    borderRadius: 13,
    fontWeight: '700',
    overflow: 'hidden',
  },
  name: { fontWeight: '600' },
  dates: { fontSize: 12, color: RenovaTheme.colors.primary, marginTop: 2 },
  status: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  link: { fontSize: 16, fontWeight: '700', color: RenovaTheme.colors.primary },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  footerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.primary,
    backgroundColor: RenovaTheme.colors.surface,
  },
  footerT: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary },
});
