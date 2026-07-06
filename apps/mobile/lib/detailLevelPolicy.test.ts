import { homeWidgetVisibleForLevel, showEstimateCategoryFilters } from './detailLevelPolicy';

if (showEstimateCategoryFilters('brief') !== false) throw new Error('brief hides category');
if (showEstimateCategoryFilters('standard') !== true) throw new Error('standard shows category');
if (homeWidgetVisibleForLevel('kpi_analytics', 'brief') !== false) throw new Error('brief hides kpi_analytics');
if (homeWidgetVisibleForLevel('activity', 'brief') !== true) throw new Error('brief keeps activity');

console.log('detailLevelPolicy.test OK');
