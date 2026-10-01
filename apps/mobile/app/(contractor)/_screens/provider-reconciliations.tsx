/** Админ: сверки с провайдерами, требующие восстановления (MKT-033). Доступ — только через AdminGate. */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { ProviderReconciliation } from '@/lib/api/teamOps';
import { useRenova } from '@/lib/context/RenovaContext';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError } from '@/lib/reportError';

export default function ProviderReconciliationsScreen() {
  const { user } = useRenova();
  const [items, setItems] = useState<ProviderReconciliation[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setItems((await api.listProviderReconciliations(user.id)).items);
      setFailed(false);
    } catch (e) {
      reportError('providerReconciliations.load', e);
      setFailed(true);
    }
  }, [user?.id]);
  useEffect(() => { void load(); }, [load]);

  const requeue = (item: ProviderReconciliation) => {
    if (!user) return;
    showActionConfirm({
      title: 'Вернуть в очередь?',
      message: 'Операция будет выполнена повторно. Действие фиксируется в журнале аудита.',
      primaryLabel: 'Вернуть',
      onPrimary: async () => {
        setBusyId(item.id);
        try {
          await api.requeueProviderReconciliation(user.id, item.id);
          await load();
        } catch (e: unknown) {
          showActionConfirm({ title: 'Не выполнено', message: e instanceof Error && e.message ? e.message : 'Не удалось вернуть в очередь' });
        } finally {
          setBusyId(null);
        }
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  return (
    <>
      <BackHeader title="Сверка провайдеров" />
      <ScrollView
        style={s.wrap}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {failed && !items ? (
          <>
            <Text style={s.meta}>Не удалось загрузить очередь.</Text>
            <PrimaryButton title="Повторить" variant="outline" onPress={load} />
          </>
        ) : items === null ? (
          <ActivityIndicator />
        ) : items.length === 0 ? (
          <Text style={s.meta}>Остановленных сверок нет.</Text>
        ) : (
          items.map((it) => (
            <View key={it.id} style={s.card}>
              <Text style={s.title}>{it.provider} · {it.operation_type}</Text>
              <Text style={s.meta}>Статус: {it.status} · попыток: {it.attempts}{it.error_code ? ` · ${it.error_code}` : ''}</Text>
              {it.recoverable ? (
                <PrimaryButton title="Вернуть в очередь" variant="outline" size="sm" disabled={busyId === it.id} onPress={() => requeue(it)} />
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background },
  card: { ...card, gap: 8, marginBottom: 10 },
  title: { fontWeight: '800', fontSize: 15, color: RenovaTheme.colors.text },
  meta: { fontSize: 13, color: RenovaTheme.colors.textMuted },
});
