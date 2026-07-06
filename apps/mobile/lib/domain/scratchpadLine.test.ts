import assert from 'node:assert/strict';
import { parseScratchpadInput } from './scratchpadLine';

assert.deepEqual(parseScratchpadInput('[ ] снять сантехнику'), { text: 'снять сантехнику', line_kind: 'checklist', done: false });
assert.deepEqual(parseScratchpadInput('[x] купить клей'), { text: 'купить клей', line_kind: 'checklist', done: true });
assert.deepEqual(parseScratchpadInput('🛒 смеситель'), { text: 'смеситель', line_kind: 'purchase', done: false });

console.log('scratchpadLine.test OK');
