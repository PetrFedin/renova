import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'expo-router';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, ChangeOrder, MaterialStats } from '@/lib/api';
import { budgetTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { ObjectTabGuide } from '@/components/screens/object/ObjectTabGuide';
import { ObjectSection } from '@/components/screens/object/ObjectSection';
import { EstimateMaterialsByRoom } from '@/components/screens/object/EstimateMaterialsByRoom';
import { EstimateWorksByRoom } from '@/components/screens/object/EstimateWorksByRoom';
import { EstimateFilterBar } from '@/components/renova/estimate/EstimateFilterBar';
import { EstimateSourceLegend } from '@/components/renova/estimate/EstimateSourceLegend';
import { changeOrderStatusLabel } from '@/constants/labels';
import { screenLayout } from '@/constants/screenLayout';
import {
  estimateTotals,
  filterEstimateLines,
  type EstimateLineTypeFilter,
} from '@/lib/domain/estimateFilters';

import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

export function CustomerEstimateView({ onNextTab }: { onNextTab?: (tab: ObjectTabId) => void }) {
  const pathname = usePathname();
  const canWrite = useWriteAllowed();
  const { user, activeProject, loadProject } = useRenova();
  const [stats, setStats] = useState<MaterialStats | null>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [lineType, setLineType] = useState<EstimateLineTypeFilter>('all');
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !activeProject) return;
    api.materialStats(user.id, activeProject.id).then(setStats).catch(() => {});
    api.listChangeOrders(user.id, activeProject.id).then(setOrders).catch(() => {});
  }, [user, activeProject?.id]);

  const allLines = activeProject?.estimate_lines || [];
  const filtered = useMemo(
    () => filterEstimateLines(allLines, { lineType, category }),
    [allLines, lineType, category],
  );
  const works = filtered.filter((l) => l.line_type === 'work');
  const materials = filtered.filter((l) => l.line_type === 'material');
  const totals = estimateTotals(allLines);
  const pendingOrders = orders.filter((o) => o.status === 'pending');

  if (!activeProject) return <ProjectEmptyState role="customer" />;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <ObjectTabGuide tab="estimate" onNextTab={onNextTab} compact />
      <ReadOnlyBanner />

      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>Итого по смете</Text>
        <Text style={styles.total}>{formatRub(activeProject.budget_planned)}</Text>
        <Text style={styles.breakdown}>
          Работы {formatRub(totals.works)} · Материалы {formatRub(totals.materials)}
        </Text>
      </View>

      <View style={styles.links}>
        <PrimaryButton title="→ Бюджет" variant="outline" compact onPress={() => pushOsNav(budgetTabRoute('customer', 'summary'), pathname)} />
        <PrimaryButton title="→ Материалы" variant="outline" compact onPress={() => pushOsNav(repairTabRoute('customer', 'materials'), pathname)} />
      </View>

      <EstimateSourceLegend compact />
      <EstimateFilterBar
        lines={allLines}
        lineType={lineType}
        category={category}
        onLineType={setLineType}
        onCategory={setCategory}
      />

      {works.length > 0 && (
        <ObjectSection title="Работы" hint={`${works.length} поз. по фильтру · раскройте комнату.`}>
          <EstimateWorksByRoom lines={works} />
        </ObjectSection>
      )}

      {materials.length > 0 && (
        <ObjectSection title="Материалы" hint={`${materials.length} поз. · факт расхода — в «Бюджет».`}>
          <EstimateMaterialsByRoom lines={materials} />
        </ObjectSection>
      )}

      {!works.length && !materials.length && (
        <Text style={styles.empty}>Нет позиций по выбранным фильтрам.</Text>
      )}

      {stats && (
        <ObjectSection title="Расходники · план и факт">
          <View style={[styles.card, stats.overrun_percent > 5 && styles.warn]}>
            <Text>
              План: {formatRub(stats.planned)} · Факт: {formatRub(stats.actual)}
            </Text>
            <Text style={styles.overrun}>Отклонение: {stats.overrun_percent}%</Text>
          </View>
        </ObjectSection>
      )}

      <ObjectSection
        title="Доп. работы"
        hint={pendingOrders.length ? 'Требуют вашего решения.' : 'Нет ожидающих согласований.'}
      >
        {orders.length === 0 && <Text style={styles.meta}>Нет доп. работ</Text>}
        {orders.map((o) => (
          <View key={o.id} style={styles.orderRow}>
            <Text style={styles.orderTitle}>
              {o.title} · {formatRub(o.amount)}
            </Text>
            <Text style={styles.meta}>Статус: {changeOrderStatusLabel(o.status)}</Text>
            {o.status === 'pending' && user && canWrite && (
              <View style={styles.actions}>
                <PrimaryButton
                  title="Одобрить"
                  onPress={async () => {
                    await api.approveChangeOrder(user.id, activeProject.id, o.id);
                    await loadProject(activeProject.id);
                    setOrders(await api.listChangeOrders(user.id, activeProject.id));
                  }}
                />
                <View style={{ height: 8 }} />
                <PrimaryButton
                  title="Отклонить"
                  variant="outline"
                  onPress={async () => {
                    await api.rejectChangeOrder(user.id, activeProject.id, o.id);
                    setOrders(await api.listChangeOrders(user.id, activeProject.id));
                  }}
                />
              </View>
            )}
          </View>
        ))}
      </ObjectSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  totalBox: { marginBottom: 12 },
  totalLabel: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  total: { fontSize: 32, fontWeight: '800', color: RenovaTheme.colors.primary, marginTop: 4 },
  breakdown: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, fontStyle: 'italic', marginBottom: 12 },
  card: {
    backgroundColor: RenovaTheme.colors.surface,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: RenovaTheme.colors.success,
  },
  warn: { borderLeftColor: RenovaTheme.colors.warning },
  overrun: { fontWeight: '700', marginTop: 4 },
  orderRow: {
    backgroundColor: RenovaTheme.colors.surface,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  orderTitle: { fontWeight: '600', fontSize: 14 },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  actions: { marginTop: 10 },
});
