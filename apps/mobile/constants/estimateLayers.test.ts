import { normalizeEstimateLayer } from './estimateLayers';

if (normalizeEstimateLayer(undefined) !== 'summary') throw new Error('default summary');
if (normalizeEstimateLayer('detail') !== 'detail') throw new Error('detail layer');
if (normalizeEstimateLayer('unknown') !== 'summary') throw new Error('unknown → summary');

console.log('estimateLayers.test OK');
