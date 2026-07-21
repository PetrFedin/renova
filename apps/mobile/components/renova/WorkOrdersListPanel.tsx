/** Список детальных работ — hub «Ремонт → Этапы» (не только календарь) */
import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { api, type WorkOrder, type Room } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { WorkOrderCard } from '@/components/renova/WorkOrderCard';
import { isWorkArchived } from '@/lib/domain/workArchive';
import { useNavFromHere } from '@/lib/navigation';
import { calendarTabHref, type OsRole } from '@/constants/osSections';
import { useAsyncResource, asyncShowError, asyncShowStale, asyncIsRefreshing, asyncIsLoading } from '@/lib/async';
import { InlineError, StaleDataBanner, EmptyState, LoadingSkeleton } from '@/components/async';

const FILTERS = [
  { key: 'active', label: 'Активные' },
  { key: 'archive', label: 'Архив' },
  { key: 'all', label: 'Все' },
] as const;

type WorkFilter = (typeof FILTERS)[number]['key'];

export function WorkOrdersListPanel({
  userId,
  projectId,
  rooms,
  role,
}: {
  userId: string;
  projectId: string;
  rooms?: Room[];
  role: OsRole;
}) {
  const nav = useNavFromHere();
  const [filter, setFilter] = useState<WorkFilter>('active');
  const { resource, data, reload: reloadRes } = useAsyncResource<WorkOrder[]>({
    contextKey: `work-orders:${projectId}`,
    enabled: Boolean(userId && projectId),
    scope: 'workOrders.list',
    fetcher: () => api.listWorkOrders(userId, projectId),
    isEmpty: (d) => d.length === 0,
  });
  const items = data ?? [];

  const reload = useCallback(() => { void reloadRes({ soft: true }); }, [reloadRes]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useProjectDataReload(reload);

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
    if (filter === 'all') return sorted;
    if (filter === 'archive') return sorted.filter((w) => isWorkArchived(w.status));
    return sorted.filter((w) => !isWorkArchived(w.status));
  }, [items, filter]);

  return (
    <View style={s.wrap}>
      <View style={s.headRow}>
        <Text style={s.head}>Детальные работы</Text>
        <Pressable onPress={() => nav.href(calendarTabHref(role))}>
          <Text style={s.calLink}>Календарь →</Text>
        </Pressable>
      </View>
      {asyncShowStale(resource) ? (
        <StaleDataBanner
          error={resource.error}
          onRetry={() => void reloadRes({ soft: true })}
          busy={asyncIsRefreshing(resource)}
        />
      ) : null}
      {asyncShowError(resource) ? (
        <InlineError
          error={resource.error}
          title="Не удалось загрузить работы"
          onRetry={() => void reloadRes({ soft: false })}
          busy={asyncIsRefreshing(resource)}
        />
      ) : null}
      {asyncIsLoading(resource) ? <LoadingSkeleton rows={2} /> : null}
      {!asyncShowError(resource) && !asyncIsLoading(resource) ? (
        <>
          <View style={s.filters}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                style={[s.chip, filter === f.key && s.chipOn]}
                onPress={() => setFilter(f.key)}
              >
                <Text style={[s.chipT, filter === f.key && s.chipTOn]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
          {filtered.map((wo) => (
            <WorkOrderCard key={wo.id} wo={wo} rooms={rooms} />
          ))}
          {!filtered.length ? (
            <EmptyState title="Нет работ по фильтру" />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  head: { fontWeight: '800', fontSize: 15, color: RenovaTheme.colors.text },
  calLink: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.primary },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: RenovaTheme.colors.surfaceMuted },
  chipOn: { backgroundColor: RenovaTheme.colors.infoBg, borderWidth: 1, borderColor: RenovaTheme.colors.accent },
  chipT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  chipTOn: { color: RenovaTheme.colors.accent },
  empty: { ...card, textAlign: 'center', color: RenovaTheme.colors.textMuted, paddingVertical: 14 },
});
