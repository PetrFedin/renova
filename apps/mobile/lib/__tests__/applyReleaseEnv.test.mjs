/** Run: node apps/mobile/lib/__tests__/applyReleaseEnv.test.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv, unfilled } from '../../../../scripts/apply-release-env.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const eas = JSON.parse(fs.readFileSync(path.join(dir, '../../eas.json'), 'utf8'));

const before = unfilled(eas);
assert.ok(before.includes('build.production.env.EXPO_PUBLIC_API_URL'));
assert.ok(before.includes('submit.production.ios.ascAppId'));
assert.ok(before.includes('submit.production.android.serviceAccountKeyPath'));

const { eas: filled, applied } = applyEnv(eas, {
  RENOVA_API_URL_STAGING: 'https://s.test',
  RENOVA_API_URL_PRODUCTION: 'https://p.test',
  RENOVA_ASC_APP_ID: '1',
  RENOVA_APPLE_TEAM_ID: 'T',
  RENOVA_GOOGLE_SERVICE_ACCOUNT_KEY_PATH: './k.json',
});
assert.deepEqual(unfilled(filled), []);
assert.equal(filled.build.testflight.env.EXPO_PUBLIC_API_URL, 'https://s.test');
assert.equal(filled.build.production.env.EXPO_PUBLIC_API_URL, 'https://p.test');
assert.equal(filled.submit.production.android.track, 'internal');
assert.ok(applied.length >= 8);
assert.ok(unfilled(eas).length === before.length, 'исходный объект не мутируется');
console.log('applyReleaseEnv.test.mjs: OK');
