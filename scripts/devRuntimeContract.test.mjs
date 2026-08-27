#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const compose = read('docker-compose.yml');
const launcher = read('scripts/start-dev.sh');
const runtime = read('scripts/dev-runtime.sh');
const dependencyHook = read('scripts/ensure-mobile-deps.js');
const envLocal = read('env.local.example');
const rootEnv = read('.env.example');
const backendEnv = read('backend/.env.example');
const agents = read('AGENTS.md');
const claude = read('CLAUDE.md');
const cursor = read('.cursor/rules/renova-agent-runtime.mdc');
const backendReadme = read('backend/README.md');

assert.equal(pkg.scripts?.dev, 'bash scripts/start-dev.sh', 'existing npm run dev must remain the stable root entrypoint');
assert.ok(launcher.includes('dev-runtime.sh'), 'root launcher must delegate to the canonical runtime');
assert.ok(launcher.includes('set -- start'), 'npm run dev without arguments must start the canonical runtime');
assert.ok(launcher.includes('"$@"'), 'root launcher must forward requested dev subcommands exactly');

for (const service of ['postgres:', 'redis:', 'minio:', 'migrate:', 'api:', 'worker:']) {
  assert.ok(compose.includes(service), `docker-compose.yml missing ${service}`);
}
assert.ok(!compose.includes(':latest'), 'canonical local compose must not use mutable latest tags');
assert.ok(compose.includes('["alembic", "upgrade", "head"]'), 'compose migrate service must be fail-fast Alembic');
assert.ok(compose.includes('python -m app.db.migration_guard && exec renova-api'), 'local API must reject stale schema even on direct Compose startup');
assert.ok(compose.includes('python -m app.db.migration_guard && exec renova-worker'), 'local worker must reject stale schema even on direct Compose startup');

assert.ok(!launcher.includes('pip install'), 'root launcher must never install packages at startup');
assert.ok(!launcher.includes('alembic upgrade head 2>/dev/null || true'), 'root launcher must never swallow migrations');

for (const token of [
  'poetry check --lock',
  'poetry sync --no-interaction',
  'python -m pip check',
  'compose run --rm migrate',
  'app.db.migration_guard',
  'app.core.runtime_preflight --skip-database',
  '/health',
  '/ready',
  'app.runtime_healthcheck',
  'renova:runtime:worker:*',
]) {
  assert.ok(runtime.includes(token), `dev runtime missing contract token: ${token}`);
}
assert.ok(!runtime.includes('pip install'), 'dev runtime must not perform ad-hoc pip installation');
assert.ok(!runtime.includes('alembic upgrade head 2>/dev/null || true'), 'dev runtime must not swallow Alembic failures');
assert.ok(!runtime.includes('npm run dev:bootstrap'), 'dev runtime diagnostics must not point to a nonexistent npm alias');
assert.ok(runtime.includes('refuses ENVIRONMENT='), 'dev runtime must fail closed outside development');

assert.ok(!dependencyHook.includes('execSync'), 'postinstall must never fetch or install missing packages dynamically');
assert.ok(!dependencyHook.includes('npm install ${missing'), 'postinstall must never mutate the npm lock/workspace');
assert.ok(dependencyHook.includes('process.exit(2)'), 'missing locked mobile dependencies must fail bootstrap');
assert.ok(dependencyHook.includes("path.join(mobile, 'node_modules', name)"), 'workspace verification must accept a valid nested mobile dependency location');

for (const token of [
  'ENVIRONMENT=development',
  'postgresql+asyncpg://renova:renova@127.0.0.1:5433/renova',
  'redis://127.0.0.1:6380/0',
  'S3_ENDPOINT=http://127.0.0.1:9000',
  'ALLOW_CREATE_ALL=false',
  'ALLOW_DEMO_SEED=true',
  'EXPO_PUBLIC_API_URL=http://127.0.0.1:8100',
  'EXPO_PUBLIC_APP_ENV=development',
]) {
  assert.ok(envLocal.includes(token), `env.local.example missing ${token}`);
  assert.ok(rootEnv.includes(token), `.env.example must not contradict canonical local token ${token}`);
}
assert.ok(!envLocal.includes('ENVIRONMENT=staging'), 'local env must not embed staging profile');
assert.ok(!envLocal.includes('ENVIRONMENT=production'), 'local env must not embed production profile');
assert.ok(backendEnv.includes('Canonical full-stack LOCAL runtime is root `env.local.example`'), 'backend env reference must point agents to the canonical local profile');

assert.ok(claude.includes('AGENTS.md'), 'CLAUDE.md must delegate to AGENTS.md');
assert.ok(cursor.includes('alwaysApply: true'), 'Cursor runtime entrypoint must always apply');
assert.ok(cursor.includes('AGENTS.md'), 'Cursor runtime entrypoint must delegate to AGENTS.md');
for (const command of ['npm run dev -- doctor', 'npm run dev -- check', 'npm run dev -- test-focused', 'npm run dev -- test-full']) {
  assert.ok(agents.includes(command), `AGENTS.md must expose ${command}`);
}

assert.ok(!backendReadme.includes('python3 -m venv .venv'), 'backend README must not teach a parallel ad-hoc virtualenv bootstrap');
assert.ok(backendReadme.includes('npm run dev -- bootstrap'), 'backend README must point back to the canonical locked bootstrap');
assert.ok(backendReadme.includes('poetry check --lock'), 'backend-only instructions must validate the Poetry lock');
assert.ok(backendReadme.includes('app.core.runtime_preflight'), 'backend-only instructions must use the canonical runtime preflight');

console.log('canonical local runtime source contract: OK');
