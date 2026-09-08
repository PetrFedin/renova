#!/usr/bin/env node
/** Small, deterministic regression for GHSA-2883-xcg3-v3hh. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const expected = lock.packages['node_modules/js-yaml'];
assert.equal(expected.version, '4.3.2', 'new YAML versions require an explicit review');
assert.equal(require('js-yaml/package.json').version, expected.version);
const yaml = require('js-yaml');
const plain = { name: '\u0420\u0435\u043c\u043e\u043d\u0442', enabled: true, qty: 12.5, scopes: ['room', 'stage'] };
assert.deepEqual(yaml.load(yaml.dump(plain)), plain);
// Three empty sources are enough: no CPU/time-based flaky large payload.
const merge = 'sources: &sources [{}, {}, {}]\nmerged: { <<: *sources }\n';
assert.deepEqual(yaml.load(merge).merged, {});
assert.throws(() => yaml.load(merge, { maxTotalMergeKeys: 2 }), yaml.YAMLException,
  'empty merge sources must consume the configured merge budget');
console.log('YAML parser integrity OK (locked 4.3.2; round-trip and bounded empty-source limit verified)');
