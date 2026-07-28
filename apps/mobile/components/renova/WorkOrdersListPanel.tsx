/** Список детальных работ — hub «Ремонт → Этапы» (не только календарь) */
import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { api, type WorkOrder, type Room } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { WorkOrderCard } from '@/components/renova/WorkOrderCard';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { isWorkArchived } from '@/lib/domain/workArchive';
import { useNavFromHere } from '@/lib/navigation';
import { calendarTabHref, type OsRole } from '@/constants/osSections';
import { reportError } from '@/lib/reportError';

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
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [filter, setFilter] = useState<WorkFilter>('active');
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(() => {
    api
      .listWorkOrders(userId, projectId)
      .then((list) => {
        setItems(list);
        setLoadError(false);
      })
      .catch((e) => {
        reportError('components.renova.WorkOrdersListPanel.Items', e);
        setLoadError(true);
      });
  }, [userId, projectId]);

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
      {loadError ? (
        <LoadErrorState
          title="Не удалось загрузить работы"
          hint="Это не пустой фильтр — повторите загрузку."
          onRetry={reload}
        />
      ) : (
        <>
          {filtered.map((wo) => (
            <WorkOrderCard key={wo.id} wo={wo} rooms={rooms} />
          ))}
          {!filtered.length && (
            <Text style={s.empty}>Нет работ по фильтру</Text>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  head: { ...screenTypography.listTitle, fontWeight: '700' },
  calLink: { ...screenTypography.listLink, marginTop: 0 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: RenovaTheme.colors.surfaceMuted },
  chipOn: { backgroundColor: RenovaTheme.colors.infoBg, borderWidth: 1, borderColor: RenovaTheme.colors.accent },
  chipT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  chipTOn: { color: RenovaTheme.colors.accent },
  empty: { ...screenTypography.empty, textAlign: 'center', paddingVertical: 14 },
});
