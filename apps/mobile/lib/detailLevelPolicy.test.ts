import { homeWidgetVisibleForLevel, objectTabGuideCompact, showEstimateCategoryFilters } from './detailLevelPolicy';

if (showEstimateCategoryFilters('brief') !== false) throw new Error('brief hides category');
if (showEstimateCategoryFilters('standard') !== true) throw new Error('standard shows category');
if (homeWidgetVisibleForLevel('risks', 'brief') !== false) throw new Error('brief hides risks');
if (homeWidgetVisibleForLevel('kpi_budget', 'brief') !== true) throw new Error('brief keeps KPI cards');
if (homeWidgetVisibleForLevel('activity', 'brief') !== true) throw new Error('brief keeps activity');

if (objectTabGuideCompact('brief') !== true) throw new Error('brief compact guide');
if (objectTabGuideCompact('detailed') !== false) throw new Error('detailed full guide');

console.log('detailLevelPolicy.test OK');
