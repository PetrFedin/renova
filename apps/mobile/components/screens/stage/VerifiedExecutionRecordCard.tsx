import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import type { VerifiedExecutionRecord } from '@/lib/api';

type Props = {
  record: VerifiedExecutionRecord | null;
  loading: boolean;
  unavailable: boolean;
};

function shortHash(value: string) {
  return value.length > 22 ? value.slice(0, 12) + '…' + value.slice(-8) : value;
}

export function VerifiedExecutionRecordCard({ record, loading, unavailable }: Props) {
  if (loading) {
    return (
      <View style={s.card}>
        <Text style={s.kicker}>VERIFIED EXECUTION RECORD</Text>
        <Text style={s.title}>Формируем доказательную запись…</Text>
      </View>
    );
  }

  if (!record) {
    return (
      <View style={[s.card, s.pending]}>
        <Text style={s.kicker}>VERIFIED EXECUTION RECORD</Text>
        <Text style={s.title}>{unavailable ? 'Запись появится после приёмки' : 'Запись временно недоступна'}</Text>
        <Text style={s.meta}>
          Verified record создаётся только из канонической приёмки, фото, чеклиста, нарядов и замечаний. Его нельзя заполнить вручную.
        </Text>
      </View>
    );
  }

  const evidence = record.evidence;
  const quality = record.quality;
  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.headerCopy}>
          <Text style={s.kicker}>VERIFIED EXECUTION RECORD · {evidence.level}</Text>
          <Text style={s.title}>Работы подтверждены приёмкой</Text>
        </View>
        <View style={s.badge}><Text style={s.badgeText}>VERIFIED</Text></View>
      </View>

      <View style={s.grid}>
        <View style={s.metric}>
          <Text style={s.metricLabel}>Чеклист</Text>
          <Text style={s.metricValue}>{evidence.checklist.done}/{evidence.checklist.total}</Text>
        </View>
        <View style={s.metric}>
          <Text style={s.metricLabel}>Фото</Text>
          <Text style={s.metricValue}>{evidence.photos.length}</Text>
        </View>
        <View style={s.metric}>
          <Text style={s.metricLabel}>Наряды</Text>
          <Text style={s.metricValue}>{record.scope.length}</Text>
        </View>
        <View style={s.metric}>
          <Text style={s.metricLabel}>Замечания</Text>
          <Text style={s.metricValue}>{quality.defects.length}</Text>
        </View>
      </View>

      {quality.warranty.length > 0 ? (
        <Text style={s.warning}>Гарантийных обращений: {quality.warranty.length}</Text>
      ) : null}

      <View style={s.lineage}>
        <Text style={s.meta}>Принято: {record.acceptance.acceptedAt}</Text>
        <Text style={s.hash}>SHA-256 · {shortHash(record.recordHashSha256)}</Text>
        <Text style={s.meta}>Источник: work_acceptances → work_orders → stage_photos → project_issues</Text>
      </View>

      <Text style={s.note}>
        E0–E2 отражают только фактически доступное evidence. Геометрия/объёмы и паспортные связи пока не сертифицируются как E3/E4.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { ...card, marginTop: RenovaTheme.spacing.md, padding: 14, gap: 10 },
  pending: { borderStyle: 'dashed' },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  headerCopy: { flex: 1, gap: 3 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: RenovaTheme.colors.textMuted },
  title: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  badge: { borderWidth: 1, borderColor: RenovaTheme.colors.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  badgeText: { color: RenovaTheme.colors.success, fontSize: 9, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { minWidth: '46%', flexGrow: 1, padding: 10, borderRadius: RenovaTheme.radius.md, backgroundColor: RenovaTheme.colors.surfaceMuted },
  metricLabel: { color: RenovaTheme.colors.textMuted, fontSize: 10 },
  metricValue: { color: RenovaTheme.colors.text, fontSize: 19, fontWeight: '800', marginTop: 2 },
  lineage: { gap: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RenovaTheme.colors.border, paddingTop: 9 },
  meta: { color: RenovaTheme.colors.textMuted, fontSize: RenovaTheme.fontSize.bodySmall, lineHeight: 17 },
  hash: { color: RenovaTheme.colors.text, fontSize: 11, fontWeight: '700' },
  warning: { color: RenovaTheme.colors.warning, fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: '700' },
  note: { color: RenovaTheme.colors.textMuted, fontSize: 10, lineHeight: 15 },
});
