import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const fail = (message) => {
  throw new Error(`mobile release integrity: ${message}`);
};

const EAS_CLI_VERSION = '21.4.0';
const NODE_VERSION = '22.22.2';
const PYTHON_VERSION = '3.12.13';
const POETRY_VERSION = '2.4.1';
const IOS_IMAGE = 'macos-tahoe-26.4-xcode-26.4';
const ANDROID_IMAGE = 'ubuntu-26.04-jdk-17-ndk-r27b';

const eas = JSON.parse(read('apps/mobile/eas.json'));
if (eas.cli?.version !== EAS_CLI_VERSION) {
  fail(`eas.json cli.version must be exactly ${EAS_CLI_VERSION}`);
}
if (/[<>=~^*]/.test(eas.cli.version)) {
  fail('eas.json cli.version must not use a range or wildcard');
}

function deepMerge(base, child) {
  const result = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(child ?? {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function resolveProfile(name, stack = []) {
  const profile = eas.build?.[name];
  if (!profile) fail(`missing EAS build profile ${name}`);
  if (stack.includes(name)) fail(`cyclic EAS profile inheritance: ${[...stack, name].join(' -> ')}`);
  if (!profile.extends) return profile;
  return deepMerge(resolveProfile(profile.extends, [...stack, name]), profile);
}

for (const name of ['development', 'preview', 'testflight', 'staging', 'production']) {
  const profile = resolveProfile(name);
  if (profile.node !== NODE_VERSION) {
    fail(`${name}: node must be exactly ${NODE_VERSION} (got ${profile.node ?? 'unset'})`);
  }
  if (profile.ios?.image !== IOS_IMAGE) {
    fail(`${name}: iOS image must be exactly ${IOS_IMAGE} (got ${profile.ios?.image ?? 'unset'})`);
  }
  if (profile.android?.image !== ANDROID_IMAGE) {
    fail(`${name}: Android image must be exactly ${ANDROID_IMAGE} (got ${profile.android?.image ?? 'unset'})`);
  }
}

const wrapper = read('scripts/eas-cli.sh');
if (!wrapper.includes(`EAS_CLI_VERSION="${EAS_CLI_VERSION}"`)) {
  fail(`scripts/eas-cli.sh must pin ${EAS_CLI_VERSION}`);
}
if (!wrapper.includes('npx --yes "eas-cli@${EAS_CLI_VERSION}"')) {
  fail('scripts/eas-cli.sh must invoke the exact pinned EAS package through npx --yes');
}
if (/eas-cli@latest/i.test(wrapper)) fail('scripts/eas-cli.sh must not use eas-cli@latest');

const workflow = read('.github/workflows/eas-build.yml');
if (!workflow.includes(`node-version: "${NODE_VERSION}"`)) {
  fail(`EAS workflow must pin GitHub Actions Node ${NODE_VERSION}`);
}
if (!workflow.includes(`python-version: "${PYTHON_VERSION}"`)) {
  fail(`EAS workflow must pin Python ${PYTHON_VERSION}`);
}
if (!workflow.includes(`"poetry==${POETRY_VERSION}"`)) {
  fail(`EAS workflow must install exact Poetry ${POETRY_VERSION}`);
}
for (const required of [
  'poetry config virtualenvs.in-project true',
  'poetry check --lock',
  'poetry sync --no-interaction',
  'poetry run python -m pip check',
  'bash ../../scripts/eas-cli.sh build',
  '--json',
  '--message',
  'bash ../../scripts/eas-cli.sh submit',
  '--id "$build_id"',
]) {
  if (!workflow.includes(required)) fail(`EAS workflow missing required release contract: ${required}`);
}
if (/eas-cli@latest/i.test(workflow)) fail('EAS workflow must not use eas-cli@latest');
if (/\s--latest(?:\s|\\|$)/m.test(workflow)) fail('EAS workflow must not submit a mutable latest build');
if (/pip install\s+poetry(?:\s|$)/m.test(workflow)) fail('EAS workflow must not install unpinned Poetry');

const preflight = read('scripts/testflight-preflight.sh');
for (const required of [
  'bash ../../scripts/eas-cli.sh whoami',
  'bash ../../scripts/eas-cli.sh project:info',
  'node scripts/check-mobile-release-integrity.mjs',
]) {
  if (!preflight.includes(required)) fail(`release preflight missing required contract: ${required}`);
}
if (/eas-cli@latest/i.test(preflight)) fail('release preflight must not use eas-cli@latest');

for (const relativePath of ['.github/workflows/eas-build.yml', 'scripts/testflight-preflight.sh']) {
  const source = read(relativePath);
  if (/npx\s+(?:--yes\s+)?eas-cli@/i.test(source)) {
    fail(`${relativePath} must use scripts/eas-cli.sh instead of invoking EAS directly`);
  }
}

console.log(
  `mobile release integrity: OK (eas-cli=${EAS_CLI_VERSION}, node=${NODE_VERSION}, python=${PYTHON_VERSION}, poetry=${POETRY_VERSION})`,
);
