/** Единый список приёмки — заказчик решает inline; исполнитель видит статус (W56 / W102) */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { pushStageDetail } from '@/lib/navigation';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { buildUnifiedAcceptanceItems, type UnifiedAcceptanceItem } from '@/lib/domain/acceptancePending';
import { api, type Stage, type WorkAcceptance } from '@/lib/api';
import { repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { useRenova } from '@/lib/context/RenovaContext';

export function UnifiedAcceptanceList({
  stages,
  acceptances,
  returnTo,
  role = 'customer',
  onChanged,
}: {
  stages: Stage[] | undefined;
  acceptances: WorkAcceptance[];
  returnTo?: string;
  role?: 'customer' | 'contractor';
  /** После accept/return — обновить parent (список acceptances) */
  onChanged?: () => void;
}) {
  const { user, activeProject } = useRenova();
  const items = buildUnifiedAcceptanceItems(stages, acceptances);
  const isContractor = role === 'contractor';
  const [busyId, setBusyId] = useState<string | null>(null);

  const projectId = activeProject?.id;
  const userId = user?.id;

  const decide = async (item: UnifiedAcceptanceItem, action: 'accept' | 'return') => {
    if (!userId || !projectId) return;
    if (item.kind !== 'acceptance') {
      // Нет WorkAcceptance — открыть этап для чеклиста/решения
      pushStageDetail(item.stageId, returnTo);
      return;
    }
    setBusyId(item.id);
    try {
      if (action === 'accept') {
        await api.acceptWork(userId, projectId, item.acceptanceId, {});
        Alert.alert('Принято', 'Этап принят. Можно перейти к оплате.');
      } else {
        await api.returnWork(userId, projectId, item.acceptanceId, {
          comment: 'Нужна доработка',
        });
        Alert.alert('На доработку', 'Исполнитель получил задачу на правку.');
      }
      await syncProjectSideEffects({ user, project: activeProject });
      onChanged?.();
    } catch (e: unknown) {
      if (isOfflineQueued(e)) notifyOfflineQueued(action === 'accept' ? 'Приёмка' : 'Возврат');
      else Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось выполнить действие');
    } finally {
      setBusyId(null);
    }
  };

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
          : `${items.length} этап(ов) ждут решения — примите или верните на доработку прямо здесь.`}
      </Text>
      {items.map((it) => (
        <AcceptanceRow
          key={it.id}
          item={it}
          isContractor={isContractor}
          busy={busyId === it.id}
          onOpen={() => pushStageDetail(it.stageId, returnTo)}
          onAccept={() => { decide(it, 'accept').catch(() => {}); }}
          onReturn={() => { decide(it, 'return').catch(() => {}); }}
        />
      ))}
    </>
  );
}

function AcceptanceRow({
  item,
  onOpen,
  onAccept,
  onReturn,
  isContractor,
  busy,
}: {
  item: UnifiedAcceptanceItem;
  onOpen: () => void;
  onAccept: () => void;
  onReturn: () => void;
  isContractor: boolean;
  busy: boolean;
}) {
  return (
    <View style={s.row}>
      <Pressable onPress={onOpen} style={{ flex: 1 }}>
        <Text style={s.title}>{item.title}</Text>
        <Text style={s.meta}>
          {item.sub}
          {item.kind === 'acceptance' ? (isContractor ? ' · у заказчика' : ' · приёмка') : ' · откройте этап'}
        </Text>
      </Pressable>
      {isContractor ? (
        <PrimaryButton title="Открыть этап" compact onPress={onOpen} />
      ) : (
        <View style={s.actions}>
          <PrimaryButton
            title="Принять этап"
            compact
            disabled={busy || item.kind !== 'acceptance'}
            onPress={item.kind === 'acceptance' ? onAccept : onOpen}
          />
          <PrimaryButton
            title="На доработку"
            compact
            variant="outline"
            disabled={busy}
            onPress={item.kind === 'acceptance' ? onReturn : onOpen}
          />
        </View>
      )}
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
  actions: { gap: 6, maxWidth: 140 },
});
