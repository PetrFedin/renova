/** Слои вкладки «Смета» — итог · изменения · детализация · документы */
import type { HubTab } from '@/components/renova/os/OsHubTabs';

export type EstimateLayer = 'summary' | 'changes' | 'detail' | 'documents';

export const ESTIMATE_LAYER_IDS = ['summary', 'changes', 'detail', 'documents'] as const;

export const ESTIMATE_LAYER_TABS: HubTab[] = [
  { id: 'summary', label: 'Итог' },
  { id: 'changes', label: 'Изменения' },
  { id: 'detail', label: 'Детализация' },
  { id: 'documents', label: 'Документы' },
];

export function normalizeEstimateLayer(layer: string | undefined): EstimateLayer {
  if (layer && (ESTIMATE_LAYER_IDS as readonly string[]).includes(layer)) {
    return layer as EstimateLayer;
  }
  return 'summary';
}

export function estimateLayerLabel(layer: string): string {
  return ESTIMATE_LAYER_TABS.find((t) => t.id === layer)?.label ?? layer;
}
