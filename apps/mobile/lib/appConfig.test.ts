/** Контракт app.config.js: env-слой поверх app.json, PLACEHOLDER-заглушки, fail-closed для store-профилей. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildConfig,
  isPlaceholder,
  PLACEHOLDER_ANDROID_PACKAGE,
  resolveApiUrl,
  resolveAppEnv,
} from '../app.config';

const base = JSON.parse(readFileSync(join(__dirname, '../app.json'), 'utf8')).expo;

// 1. Без окружения: dev-значения, заглушки помечены, базовые поля app.json сохранены.
const dev = buildConfig(base, {});
assert.equal(dev.ios?.bundleIdentifier, 'ru.renova.app');
assert.equal(dev.ios?.buildNumber, base.ios.buildNumber);
assert.equal(dev.android?.versionCode, base.android.versionCode);
assert.equal(dev.android?.package, PLACEHOLDER_ANDROID_PACKAGE);
assert.ok(isPlaceholder(dev.android?.package));
assert.equal(dev.extra?.appEnv, 'development');
assert.equal(dev.extra?.apiUrl, 'http://127.0.0.1:8100');
assert.equal(dev.extra?.locale, 'ru');
assert.equal(dev.owner, undefined);
assert.equal(dev.extra?.eas, undefined);
assert.ok((dev.extra?.releaseConfigGaps as string[]).includes('RENOVA_ANDROID_PACKAGE'));
assert.ok(!('ITSAppUsesNonExemptEncryption' in (dev.ios?.infoPlist ?? {})), 'декларация не выдумывается');

// 2. expo-camera, CAMERA, блокировка RECORD_AUDIO; существующие плагины на месте.
assert.ok(dev.plugins?.some((p) => Array.isArray(p) && p[0] === 'expo-camera'));
assert.ok(dev.plugins?.some((p) => Array.isArray(p) && p[0] === 'expo-notifications'));
assert.ok(dev.android?.permissions?.includes('CAMERA'));
assert.ok(dev.android?.blockedPermissions?.includes('android.permission.RECORD_AUDIO'));
assert.equal(buildConfig(dev, {}).plugins?.filter((p) => (Array.isArray(p) ? p[0] : p) === 'expo-camera').length, 1);

// 3. Значения из env.
const filled = buildConfig(base, {
  RENOVA_APP_ENV: 'production',
  RENOVA_IOS_BUNDLE_ID: 'com.example.real',
  RENOVA_ANDROID_PACKAGE: 'com.example.real',
  RENOVA_EAS_OWNER: 'acme',
  RENOVA_EAS_PROJECT_ID: '00000000-0000-0000-0000-000000000000',
  RENOVA_API_URL_PRODUCTION: 'https://api.acme.test',
  RENOVA_EXPORT_COMPLIANCE_EXEMPT: 'true',
  EAS_BUILD_PROFILE: 'production',
});
assert.equal(filled.ios?.bundleIdentifier, 'com.example.real');
assert.equal(filled.android?.package, 'com.example.real');
assert.equal(filled.owner, 'acme');
assert.equal((filled.extra?.eas as { projectId: string }).projectId, '00000000-0000-0000-0000-000000000000');
assert.equal(filled.extra?.apiUrl, 'https://api.acme.test');
assert.deepEqual(filled.extra?.releaseConfigGaps, []);
assert.equal((filled.ios?.infoPlist as Record<string, unknown>).ITSAppUsesNonExemptEncryption, false);

// 4. API URL: EXPO_PUBLIC_API_URL приоритетнее; без значений staging/prod — явный PLACEHOLDER.
assert.equal(resolveApiUrl({ EXPO_PUBLIC_API_URL: 'https://x.test', RENOVA_API_URL_STAGING: 'https://y.test' }, 'staging'), 'https://x.test');
assert.ok(isPlaceholder(resolveApiUrl({}, 'staging')));
assert.ok(resolveApiUrl({}, 'production').includes('PLACEHOLDER'));
assert.equal(resolveAppEnv({ EXPO_PUBLIC_APP_ENV: 'staging' }), 'staging');
assert.throws(() => resolveAppEnv({ RENOVA_APP_ENV: 'prod-ish' }));

// 5. Fail-closed: store-профиль с заглушками не собирается, пока не разрешено явно.
assert.throws(() => buildConfig(base, { EAS_BUILD_PROFILE: 'production', RENOVA_APP_ENV: 'production' }), /PLACEHOLDER|незаполненными/);
assert.throws(() => buildConfig(base, { EAS_BUILD_PROFILE: 'testflight', RENOVA_APP_ENV: 'staging' }), /незаполненными/);
assert.doesNotThrow(() => buildConfig(base, { EAS_BUILD_PROFILE: 'preview', RENOVA_APP_ENV: 'staging' }));
assert.doesNotThrow(() =>
  buildConfig(base, { EAS_BUILD_PROFILE: 'production', RENOVA_APP_ENV: 'production', RENOVA_ALLOW_PLACEHOLDER_CONFIG: '1' }),
);

console.log('appConfig.test.ts: OK');
