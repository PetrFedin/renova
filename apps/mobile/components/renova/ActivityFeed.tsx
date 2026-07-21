import { useState, useCallback } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ActivityItem } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { GlobalFilterBar } from '@/components/renova/GlobalFilterBar';
import { pushOsNav } from '@/lib/pushOsNav';
import { useRenova } from '@/lib/context/RenovaContext';
import type { OsRole } from '@/constants/osSections';
import { useAsyncResource, asyncShowError, asyncShowStale, asyncIsRefreshing, asyncIsLoading } from '@/lib/async';
import { InlineError, StaleDataBanner, EmptyState, LoadingSkeleton } from '@/components/async';

const KINDS = [{ k: '', l: 'Все' }, { k: 'material', l: 'Материалы' }, { k: 'approval', l: 'Согласования' }, { k: 'room_change', l: 'Комнаты' }];

export function ActivityFeed({
  userId,
  projectId,
  compact,
  hidePaymentDupes,
  returnTo,
}: {
  userId: string;
  projectId: string;
  compact?: boolean;
  hidePaymentDupes?: boolean;
  /** Путь «назад» — с главной передаётся текущий pathname */
  returnTo?: string;
}) {
  const [kind, setKind] = useState('');
  const [wt, setWt] = useState<string | undefined>();
  const { user } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const back = returnTo || '/';

  const { resource, data, reload: reloadRes } = useAsyncResource<ActivityItem[]>({
    contextKey: `activity:${projectId}:${kind}:${wt || ''}:${compact ? 'c' : 'f'}`,
    enabled: Boolean(userId && projectId),
    scope: 'activity.feed',
    fetcher: async () => {
      let list = await api.activityFeed(userId, projectId, kind || undefined, wt);
      if (compact) list = list.slice(0, 3);
      if (hidePaymentDupes) list = list.filter((it) => !/оплат/i.test(it.title));
      return list;
    },
    isEmpty: (d) => d.length === 0,
  });
  const items = data ?? [];

  const reload = useCallback(() => { void reloadRes({ soft: true }); }, [reloadRes]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useProjectDataReload(reload);

  const openItem = (it: ActivityItem) => {
    if (!it.link_path) return;
    // W116: единый SoT — pushOsNav / resolvePushLink (не сырой router)
    pushOsNav(it.link_path, back, role);
  };

  return (
    <View style={s.box}>
      <Text style={s.head}>{compact ? 'Недавнее' : 'Архив действий'}</Text>
      {asyncShowStale(resource) ? (
        <StaleDataBanner error={resource.error} onRetry={() => void reloadRes({ soft: true })} busy={asyncIsRefreshing(resource)} />
      ) : null}
      {asyncShowError(resource) ? (
        <InlineError error={resource.error} title="Не удалось загрузить ленту" onRetry={() => void reloadRes({ soft: false })} busy={asyncIsRefreshing(resource)} />
      ) : null}
      {asyncIsLoading(resource) ? <LoadingSkeleton rows={2} height={40} /> : null}
      {!compact && <ScrollView horizontal style={{ marginBottom: 6 }}>{KINDS.map((x) => <Pressable key={x.k} style={[s.ch, kind === x.k && s.on]} onPress={() => setKind(x.k)}><Text style={s.ct}>{x.l}</Text></Pressable>)}</ScrollView>}
      {!compact && <GlobalFilterBar kind={kind} workType={wt} onKind={setKind} onWorkType={setWt} />}
      {items.map((it) => (
        <Pressable key={it.id} style={s.row} onPress={() => openItem(it)}>
          <Text style={s.t}>{it.title}</Text>
          {it.body ? <Text style={s.b} numberOfLines={2}>{it.body}</Text> : null}
          <Text style={s.d}>{it.at.slice(0, 16).replace('T', ' ')}</Text>
        </Pressable>
      ))}
      {!asyncShowError(resource) && !asyncIsLoading(resource) && !items.length ? (
        <EmptyState title={compact ? 'Пока нет событий' : 'Лента пуста'} />
      ) : null}
      {compact && (
        <Pressable onPress={() => pushOsNav('/activity', back, role)}>
          <Text style={s.more}>Весь архив →</Text>
        </Pressable>
      )}
    </View>
  );
}
const s = StyleSheet.create({ box: { marginVertical: 8 }, head: { fontWeight: '800', marginBottom: 6 }, ch: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: RenovaTheme.colors.border, marginRight: 6 }, on: { backgroundColor: '#2563eb' }, ct: { fontSize: 11 }, row: { backgroundColor: RenovaTheme.colors.surface, padding: 8, borderRadius: 8, marginBottom: 4 }, t: { fontWeight: '600', fontSize: 13 }, b: { fontSize: 11, color: '#666' }, d: { fontSize: 10, color: '#999', marginTop: 2 }, more: { color: '#2563eb', marginTop: 6, fontSize: 12 } });
