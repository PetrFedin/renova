import assert from 'node:assert/strict';
import { unitRu } from './unitLabel';

assert.equal(unitRu('m2'), 'м²');
assert.equal(unitRu('M2'), 'м²');
assert.equal(unitRu('pcs'), 'шт');
assert.equal(unitRu('l'), 'л');
assert.equal(unitRu('точка'), 'точка');
assert.equal(unitRu(null), '');
assert.equal(unitRu('рулон'), 'рулон');
console.log('unitLabel.test OK');
