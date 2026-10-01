import assert from 'node:assert/strict';
import { resolveSavedSelection } from './portfolioSelection';

const all = ['a', 'b', 'c'];
assert.deepEqual([...resolveSavedSelection(null, all)], all, 'нет сохранённого — все');
assert.deepEqual([...resolveSavedSelection('[]', all)], [], '«Снять все» запоминается');
assert.deepEqual([...resolveSavedSelection('["b"]', all)], ['b']);
assert.deepEqual([...resolveSavedSelection('["x"]', all)].sort(), all, 'устаревшие id — все');
assert.deepEqual([...resolveSavedSelection('not json', all)], all);
assert.deepEqual([...resolveSavedSelection('{"a":1}', all)], all);
assert.deepEqual([...resolveSavedSelection('["a"]', [])], []);

console.log('portfolioSelection.test OK');
