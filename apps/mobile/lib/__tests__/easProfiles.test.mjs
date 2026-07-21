/**
 * Contract: eas.json profiles for TestFlight must not point mobile builds at localhost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const easPath = path.join(root, '../../eas.json');
const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));

const required = ['development', 'preview', 'testflight', 'production'];
for (const name of required) {
  if (!eas.build?.[name]) throw new Error(`missing build profile: ${name}`);
}

function assertNoLocalhost(profileName) {
  const url = eas.build[profileName]?.env?.EXPO_PUBLIC_API_URL ?? '';
  if (/127\.0\.0\.1|localhost/i.test(url)) {
    throw new Error(`${profileName}: EXPO_PUBLIC_API_URL must not be localhost (${url})`);
  }
}

assertNoLocalhost('testflight');
assertNoLocalhost('production');
assertNoLocalhost('preview');

const tf = eas.build.testflight;
if (tf.distribution !== 'store') throw new Error('testflight profile must use distribution=store');
if (!tf.env?.EXPO_PUBLIC_DEMO || tf.env.EXPO_PUBLIC_DEMO === '1') {
  throw new Error('testflight must set EXPO_PUBLIC_DEMO=0');
}

for (const name of ['preview', 'testflight', 'staging', 'production']) {
  const appEnv = eas.build[name]?.env?.EXPO_PUBLIC_APP_ENV;
  if (!appEnv || appEnv === 'development') {
    throw new Error(`${name}: EXPO_PUBLIC_APP_ENV must be staging|production (got ${appEnv})`);
  }
}

console.log('easProfiles.test.mjs: OK');

