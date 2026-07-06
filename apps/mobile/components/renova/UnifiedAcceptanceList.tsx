/** Единый список приёмки — только переход на этап (приёмка через чеклист на /stage/:id) */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { pushStageDetail } from '@/lib/navigation';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { buildUnifiedAcceptanceItems, type UnifiedAcceptanceItem } from '@/lib/domain/acceptancePending';
import type { Stage, WorkAcceptance } from '@/lib/api';

export function UnifiedAcceptanceList({
  stages,
  acceptances,
  returnTo,
}: {
  stages: Stage[] | undefined;
  acceptances: WorkAcceptance[];
  /** Куда вернуться с экрана этапа */
  returnTo?: string;
}) {
  const items = buildUnifiedAcceptanceItems(stages, acceptances);

  if (!items.length) {
    return <Text style={s.empty}>Нет работ, ожидающих приёмки</Text>;
  }

  return (
    <>
      <Text style={s.hint}>Откройте этап, отметьте чеклист и примите или верните на доработку.</Text>
      {items.map((it) => (
        <AcceptanceRow
          key={it.id}
          item={it}
          onOpen={() => pushStageDetail(it.stageId, returnTo)}
        />
      ))}
    </>
  );
}

function AcceptanceRow({
  item,
  onOpen,
}: {
  item: UnifiedAcceptanceItem;
  onOpen: () => void;
}) {
  return (
    <View style={s.row}>
      <Pressable onPress={onOpen} style={{ flex: 1 }}>
        <Text style={s.title}>{item.title}</Text>
        <Text style={s.meta}>
          {item.sub}
          {item.kind === 'acceptance' ? ' · приёмка' : ''}
        </Text>
      </Pressable>
      <PrimaryButton title="Проверить" compact onPress={onOpen} />
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 10, lineHeight: 16 },
  row: { ...card, paddingVertical: 12, marginBottom: 8 },
  title: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 12 },
});
