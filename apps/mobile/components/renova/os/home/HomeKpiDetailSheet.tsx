/** Sheet детализации KPI на главной — кратко, без ухода в раздел */
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { homeTypography } from '@/constants/homeTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { buildHomeKpiDetail, type HomeKpiBar } from '@/lib/domain/buildHomeKpiDetail';
import type { ProjectOsSnapshot } from '@/lib/domain/osTypes';
import type { OsRole } from '@/constants/osSections';
import { useOsNavFromHere } from '@/lib/navigation';

const BAR_COLORS: Record<NonNullable<HomeKpiBar['tone']>, string> = {
  good: RenovaTheme.colors.success,
  warn: RenovaTheme.colors.warning,
  danger: RenovaTheme.colors.danger,
  neutral: RenovaTheme.colors.primary,
};

type Props = {
  widgetId: string | null;
  snap: ProjectOsSnapshot;
  role: OsRole;
  onClose: () => void;
};

export function HomeKpiDetailSheet({ widgetId, snap, role, onClose }: Props) {
  const { pushNav } = useOsNavFromHere(role);
  if (!widgetId) return null;

  const detail = buildHomeKpiDetail(widgetId, snap, role);
  if (!detail) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={s.handle} />
          <Text style={s.title}>{detail.title}</Text>
          {detail.lead ? <Text style={s.lead}>{detail.lead}</Text> : null}

          {detail.bars?.map((bar) => (
            <View key={bar.label} style={s.barBlock}>
              <View style={s.barHead}>
                <Text style={s.barLabel}>{bar.label}</Text>
                <Text style={s.barPct}>{Math.round(bar.percent)}%</Text>
              </View>
              <View style={s.barTrack}>
                <View
                  style={[
                    s.barFill,
                    {
                      width: `${Math.min(100, Math.max(0, bar.percent))}%`,
                      backgroundColor: BAR_COLORS[bar.tone || 'neutral'],
                    },
                  ]}
                />
              </View>
            </View>
          ))}

          <View style={s.rows}>
            {detail.rows.map((row) => (
              <View key={row.label} style={s.row}>
                <Text style={s.rowLabel}>{row.label}</Text>
                <Text style={s.rowValue}>{row.value}</Text>
              </View>
            ))}
          </View>

          <PrimaryButton
            title={detail.actionLabel.replace(' →', '')}
            fullWidth
            onPress={() => {
              onClose();
              pushNav(detail.actionHref);
            }}
          />
          <Pressable style={s.closeLink} onPress={onClose} hitSlop={8}>
            <Text style={homeTypography.link}>Закрыть</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    ...card,
    marginBottom: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    padding: 20,
    paddingBottom: 28,
    maxHeight: '78%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: RenovaTheme.colors.border,
    marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: '800', color: RenovaTheme.colors.text },
  lead: { fontSize: 14, color: RenovaTheme.colors.textMuted, marginTop: 6, marginBottom: 4 },
  barBlock: { marginTop: 14 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barLabel: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  barPct: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.text },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: '#EEF2F6', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  rows: { marginTop: 12, marginBottom: 16, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { flex: 1, fontSize: 13, color: RenovaTheme.colors.textMuted },
  rowValue: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text, textAlign: 'right' },
  closeLink: { alignItems: 'center', marginTop: 12 },
});
