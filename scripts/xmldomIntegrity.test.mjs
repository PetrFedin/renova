#!/usr/bin/env node
/** Locked XML parser and real plist consumer compatibility. No provider calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const copies = Object.entries(lock.packages).filter(([name]) => name.endsWith('/@xmldom/xmldom'));
assert.ok(copies.length > 0, 'no locked XML parser found');
function supported(version) {
  const match = /^0\.(8|9)\.(\d+)$/.exec(version || '');
  return Boolean(match && Number(match[2]) >= (match[1] === '8' ? 15 : 12));
}
for (const version of ['0.8.13', '0.8.14', '0.9.10', '0.9.11', '0.9.12-beta.1', '1.0.0']) {
  assert.equal(supported(version), false, `unreviewed parser accepted: ${version}`);
}
// Plist dictionaries may intentionally have a null prototype. Compare all data
// values and types, not Object.prototype identity (which XML cannot represent).
function dataValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(dataValue);
  const proto = Object.getPrototypeOf(value);
  assert.ok(proto === null || proto === Object.prototype, 'unexpected plist object');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dataValue(item)]));
}
let checked = 0;
for (const [location, metadata] of copies) {
  assert.ok(supported(metadata.version), `${location}: upgrade/review vulnerable or unknown parser ${metadata.version}`);
  assert.match(metadata.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(metadata.resolved, `https://registry.npmjs.org/@xmldom/xmldom/-/xmldom-${metadata.version}.tgz`);
  const actual = require(path.join(root, location, 'package.json'));
  assert.equal(actual.version, metadata.version, 'installed parser differs from reviewed lock');
  const { DOMParser, XMLSerializer } = require(path.join(root, location));
  const source = '<root><text>Renova &amp; \u0440\u0435\u043c\u043e\u043d\u0442 &lt;ok&gt;</text></root>';
  const parsed = new DOMParser().parseFromString(source, 'application/xml');
  assert.equal(parsed.getElementsByTagName('text')[0].textContent, 'Renova & \u0440\u0435\u043c\u043e\u043d\u0442 <ok>');
  const serialized = new XMLSerializer().serializeToString(parsed);
  assert.equal(new DOMParser().parseFromString(serialized, 'application/xml').documentElement.textContent, parsed.documentElement.textContent);
  if (metadata.version.startsWith('0.9.')) {
    const html = '<html><body>' + '<script>x</ScRiPt>'.repeat(120) + '</body></html>';
    const result = new XMLSerializer().serializeToString(new DOMParser().parseFromString(html, 'text/html'));
    assert.ok(result.length <= html.length * 4, 'HTML raw-text output amplification regression');
  }
  checked += 1;
}
for (const consumer of ['@expo/plist', 'plist']) {
  const consumerRequire = createRequire(require.resolve(consumer));
  const parserVersion = consumerRequire('@xmldom/xmldom/package.json').version;
  assert.ok(supported(parserVersion), `${consumer} resolves unsafe parser ${parserVersion}`);
  const namespace = require(consumer);
  const plist = namespace.default ?? namespace;
  assert.equal(typeof plist.build, 'function');
  assert.equal(typeof plist.parse, 'function');
  const value = {
    CFBundleDisplayName: '\u0420\u0435\u043c\u043e\u043d\u0442 Renova',
    NSCameraUsageDescription: '\u0424\u043e\u0442\u043e & \u0430\u043a\u0442 <\u043f\u0440\u0438\u0451\u043c\u043a\u0430>',
    enabled: true, count: 3, amount: 1250.25,
    schemes: ['renova', 'https'], nested: { offline: false },
  };
  assert.deepEqual(dataValue(plist.parse(plist.build(value))), value, `${consumer}: native configuration round-trip failed`);
  const binary = { data: Buffer.from([0, 127, 128, 255]), at: new Date('2026-09-09T00:00:00.000Z') };
  assert.deepEqual(dataValue(plist.parse(plist.build(binary))), binary, `${consumer}: binary/date round-trip failed`);
  checked += 1;
}
console.log(`XML dependency integrity OK (${copies.length} locked copies, ${checked} parser/consumer checks; negative version controls passed)`);
