import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import type { EstimateLifecycleLine } from '@/lib/api';

function originLabel(origin: EstimateLifecycleLine['origin']) {
  if (origin === 'import') return 'Импорт';
  if (origin === 'manual') return 'Ручная';
  return 'Системная';
}

export function RemovedEstimateLinesPanel({
  lines,
  role,
  canRestore,
  busyId,
  onRestore,
}: {
  lines: EstimateLifecycleLine[];
  role: 'customer' | 'contractor';
  canRestore: boolean;
  busyId?: string | null;
  onRestore?: (line: EstimateLifecycleLine) => void;
}) {
  if (!lines.length) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Убранные строки · {lines.length}</Text>
      <Text style={styles.hint}>
        {role === 'contractor'
          ? 'Строки исключены из текущей сметы и её итогов. До фиксации их можно восстановить с тем же ID.'
          : 'История строк, которые исполнитель убрал из черновика. Они не входят в текущую сумму сметы.'}
      </Text>
      {lines.map((line) => (
        <View key={line.id} style={styles.row}>
          <View style={styles.main}>
            <Text style={styles.name}>{line.name}</Text>
            <Text style={styles.meta}>
              {originLabel(line.origin)} · {line.room_name || 'Общее'} · {formatRub(line.total)}
              {line.removed_at ? ` · убрана ${line.removed_at.slice(0, 10)}` : ''}
            </Text>
          </View>
          {role === 'contractor' && canRestore && onRestore ? (
            <PrimaryButton
              title="Восстановить"
              variant="outline"
              compact
              loading={busyId === line.id}
              disabled={Boolean(busyId && busyId !== line.id)}
              onPress={() => onRestore(line)}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RenovaTheme.colors.border,
    paddingTop: 12,
    gap: 8,
  },
  title: { ...screenTypography.section, marginTop: 0 },
  hint: { ...screenTypography.empty, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
  },
  main: { flex: 1, minWidth: 0 },
  name: { ...screenTypography.listTitle },
  meta: { ...screenTypography.listMeta, marginTop: 3 },
});
