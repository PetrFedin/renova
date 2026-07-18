import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { useRenova } from '@/lib/context/RenovaContext';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, ChangeOrder, MaterialStats } from '@/lib/api';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { ObjectTabGuide } from '@/components/screens/object/ObjectTabGuide';
import { OsHubTabs } from '@/components/renova/os/OsHubTabs';
import { EstimateSummaryLayer } from '@/components/screens/estimate/EstimateSummaryLayer';
import { EstimateChangesLayer } from '@/components/screens/estimate/EstimateChangesLayer';
import { EstimateDetailLayer } from '@/components/screens/estimate/EstimateDetailLayer';
import { EstimateDocumentsLayer } from '@/components/screens/estimate/EstimateDocumentsLayer';
import { screenLayout } from '@/constants/screenLayout';
import {
  ESTIMATE_LAYER_TABS,
  normalizeEstimateLayer,
  type EstimateLayer,
} from '@/constants/estimateLayers';
import { estimateTotals, type EstimateLineTypeFilter } from '@/lib/domain/estimateFilters';
import { useDetailLevel } from '@/lib/useDetailLevel';
import { showEstimateCategoryFilters } from '@/lib/detailLevelPolicy';

import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

export function CustomerEstimateView({ onNextTab }: { onNextTab?: (tab: ObjectTabId) => void }) {
  const pathname = usePathname();
  const { estimateLayer: estimateLayerParam } = useLocalSearchParams<{ estimateLayer?: string }>();
  const detailLevel = useDetailLevel();
  const canWrite = useWriteAllowed();
  const { user, activeProject, loadProject } = useRenova();
  const [stats, setStats] = useState<MaterialStats | null>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [layer, setLayer] = useState<EstimateLayer>('summary');
  const [lineType, setLineType] = useState<EstimateLineTypeFilter>('all');
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !activeProject) return;
    api.materialStats(user.id, activeProject.id).then(setStats).catch(() => {});
    api.listChangeOrders(user.id, activeProject.id).then(setOrders).catch(() => {});
  }, [user, activeProject?.id]);

  useEffect(() => {
    if (typeof estimateLayerParam === 'string' && estimateLayerParam) {
      setLayer(normalizeEstimateLayer(estimateLayerParam));
    }
  }, [estimateLayerParam]);

  const allLines = activeProject?.estimate_lines || [];
  const totals = useMemo(() => estimateTotals(allLines), [allLines]);
  const pendingOrders = orders.filter((o) => o.status === 'pending');

  const tabs = useMemo(
    () =>
      ESTIMATE_LAYER_TABS.map((t) =>
        t.id === 'changes' && pendingOrders.length ? { ...t, badge: pendingOrders.length } : t,
      ),
    [pendingOrders.length],
  );

  if (!activeProject || !user) return <ProjectEmptyState role="customer" />;

  const activeLayer = normalizeEstimateLayer(layer);
  const stagesCount = activeProject.stages?.length || 0;
  const roomsCount = activeProject.rooms?.length || activeProject.rooms_count || 0;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <ObjectTabGuide tab="estimate" onNextTab={onNextTab} />
      <ReadOnlyBanner />

      <OsHubTabs tabs={tabs} value={activeLayer} onChange={(id) => setLayer(normalizeEstimateLayer(id))} />

      {activeLayer === 'summary' && (
        <EstimateSummaryLayer
          project={activeProject}
          totals={totals}
          pathname={pathname}
          roomsCount={roomsCount}
          stagesCount={stagesCount}
          pendingChanges={pendingOrders.length}
        />
      )}

      {activeLayer === 'changes' && (
        <EstimateChangesLayer
          userId={user.id}
          projectId={activeProject.id}
          orders={orders}
          canWrite={canWrite}
          onOrdersChanged={setOrders}
          onProjectReload={() => loadProject(activeProject.id)}
        />
      )}

      {activeLayer === 'detail' && (
        <EstimateDetailLayer
          lines={allLines}
          stats={stats}
          lineType={lineType}
          category={category}
          onLineType={setLineType}
          onCategory={setCategory}
          showCategoryFilters={showEstimateCategoryFilters(detailLevel)}
        />
      )}

      {activeLayer === 'documents' && (
        <EstimateDocumentsLayer userId={user.id} projectId={activeProject.id} pathname={pathname} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
});
