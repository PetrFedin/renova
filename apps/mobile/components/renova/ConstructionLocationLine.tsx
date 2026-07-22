/** Единое отображение строительной локации для работ, QC и связанных сущностей. */
import { Text, View, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import type { Room, Stage } from '@/lib/api';
import { resolveConstructionLocation } from '@/lib/domain/constructionLocation';

type Props = {
  roomId?: string | null;
  stageId?: string | null;
  floorPlanId?: string | null;
  xPct?: number | null;
  yPct?: number | null;
  rooms?: readonly Room[];
  stages?: readonly Stage[];
  compact?: boolean;
  hideWhenUnlocated?: boolean;
};

export function ConstructionLocationLine({
  roomId,
  stageId,
  floorPlanId,
  xPct,
  yPct,
  rooms,
  stages,
  compact,
  hideWhenUnlocated,
}: Props) {
  const location = resolveConstructionLocation({
    roomId,
    stageId,
    floorPlanId,
    xPct,
    yPct,
    rooms,
    stages,
  });

  if (hideWhenUnlocated && location.resolution === 'unlocated') return null;

  const isIncomplete = location.resolution !== 'resolved';
  const statusLabel = location.resolution === 'partial'
    ? 'Неполная привязка'
    : location.resolution === 'unlocated'
      ? 'Требуется локация'
      : null;

  return (
    <View
      style={[s.row, compact && s.compact]}
      accessibilityLabel={`Локация: ${location.label}${statusLabel ? `. ${statusLabel}` : ''}`}
    >
      <Text style={[s.pin, isIncomplete && s.pinWarning]}>⌖</Text>
      <Text style={[s.label, compact && s.labelCompact, isIncomplete && s.labelWarning]} numberOfLines={compact ? 1 : 2}>
        {location.label}
      </Text>
      {statusLabel && !compact ? (
        <Text style={s.warning}>{statusLabel}</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  compact: { marginTop: 2 },
  pin: { fontSize: 12, color: RenovaTheme.colors.accent, fontWeight: '700' },
  pinWarning: { color: RenovaTheme.colors.warningText },
  label: { flexShrink: 1, fontSize: 12, color: RenovaTheme.colors.textMuted },
  labelCompact: { fontSize: 11 },
  labelWarning: { color: RenovaTheme.colors.warningText },
  warning: {
    fontSize: 10,
    fontWeight: '700',
    color: RenovaTheme.colors.warningText,
    backgroundColor: RenovaTheme.colors.warningBg,
    borderColor: RenovaTheme.colors.warningBorder,
    borderWidth: 1,
    borderRadius: RenovaTheme.radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
