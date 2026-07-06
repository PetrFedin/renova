import { collectEstimateCategories, estimateLineSource, filterEstimateLines, resolveEstimateCategory } from './estimateFilters';

const lines = [
  { id: '1', line_type: 'work', name: 'A', category: 'electrical', calc_detail: '8 шт', quantity_planned: 1, unit_price: 100 },
  { id: '2', line_type: 'material', name: 'B', category: null, quantity_planned: 2, unit_price: 50 },
  { id: '3', line_type: 'work', name: 'C', category: 'demolition', quantity_planned: 1, unit_price: 200 },
] as any[];

if (estimateLineSource(lines[0]) !== 'auto') throw new Error('auto source');
if (estimateLineSource(lines[2]) !== 'manual') throw new Error('manual source');
if (resolveEstimateCategory(lines[1]) !== 'materials') throw new Error('material category');
if (filterEstimateLines(lines, { lineType: 'material' }).length !== 1) throw new Error('type filter');
if (filterEstimateLines(lines, { category: 'electrical' }).length !== 1) throw new Error('category filter');
if (collectEstimateCategories(lines).length !== 3) throw new Error('categories collect');

console.log('estimateFilters.test OK');
