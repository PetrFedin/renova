/** Единый список приёмки — заказчик решает; исполнитель видит статус ожидания (W56) */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { pushStageDetail } from '@/lib/navigation';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { buildUnifiedAcceptanceItems, type UnifiedAcceptanceItem } from '@/lib/domain/acceptancePending';
import type { Stage, WorkAcceptance } from '@/lib/api';
import { repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

export function UnifiedAcceptanceList({
  stages,
  acceptances,
  returnTo,
  role = 'customer',
}: {
  stages: Stage[] | undefined;
  acceptances: WorkAcceptance[];
  returnTo?: string;
  role?: 'customer' | 'contractor';
}) {
  const items = buildUnifiedAcceptanceItems(stages, acceptances);
  const isContractor = role === 'contractor';

  if (!items.length) {
    return (
      <View style={s.emptyBox}>
        <Text style={s.empty}>
          {isContractor ? 'Нет этапов на приёмке у заказчика' : 'Сейчас ничего не ждёт вашей приёмки'}
        </Text>
        <PrimaryButton
          title="Открыть этапы"
          variant="outline"
          compact
          // W56: filter=review есть у Works; awaiting — нет у contractor
          onPress={() => pushOsNav(repairTabRoute(role, 'works', 'review'), returnTo)}
        />
      </View>
    );
  }

  return (
    <>
      <Text style={s.hint}>
        {isContractor
          ? `${items.length} этап(ов) у заказчика на проверке — откройте этап или отправьте повторно из работ.`
          : `${items.length} этап(ов) ждут проверки — откройте, отметьте чеклист и примите или верните на доработку.`}
      </Text>
      {items.map((it) => (
        <AcceptanceRow
          key={it.id}
          item={it}
          isContractor={isContractor}
          onOpen={() => pushStageDetail(it.stageId, returnTo)}
        />
      ))}
    </>
  );
}

function AcceptanceRow({
  item,
  onOpen,
  isContractor,
}: {
  item: UnifiedAcceptanceItem;
  onOpen: () => void;
  isContractor: boolean;
}) {
  return (
    <View style={s.row}>
      <Pressable onPress={onOpen} style={{ flex: 1 }}>
        <Text style={s.title}>{item.title}</Text>
        <Text style={s.meta}>
          {item.sub}
          {item.kind === 'acceptance' ? (isContractor ? ' · у заказчика' : ' · приёмка') : ''}
        </Text>
      </Pressable>
      <PrimaryButton
        title={isContractor ? 'Открыть этап' : 'Принять этап'}
        compact
        onPress={onOpen}
      />
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 10, lineHeight: 16 },
  row: { ...card, paddingVertical: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 10, textAlign: 'center' },
  emptyBox: { ...card, alignItems: 'center', paddingVertical: 16 },
});
