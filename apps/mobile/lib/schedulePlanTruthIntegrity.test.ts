import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const client = read('apps/mobile/lib/api/client.ts');
const api = read('apps/mobile/lib/api/workSchedule.ts');
const state = read('apps/mobile/lib/domain/schedulePlanState.ts');
const hook = read('apps/mobile/lib/hooks/useSchedulePlanState.ts');
const screen = read('apps/mobile/components/screens/schedule/UnifiedScheduleView.tsx');

assert.match(client, /cacheFallback\?: boolean/, 'truth-sensitive GET must be able to disable durable fallback');
assert.match(client, /if \(isGet && cacheFallback && canFallbackToCache\(error\)\)/, 'cache fallback must be explicit');
assert.match(client, /if \(fetchOpts\.signal\?\.aborted\) throw error/, 'project-switch abort must remain cancellable');
assert.doesNotMatch(client, /Запустите backend|uvicorn|npm run backend:dev/, 'production errors must not expose developer commands');

assert.match(api, /fetchActiveSchedulePlan/, 'schedule API must expose an explicit truth result');
assert.match(api, /cacheFallback: false/, 'active schedule existence must never use stale cache as truth');
assert.match(api, /data == null \? \{ kind: 'absent' \}/, 'only successful null may prove absence');
assert.match(api, /error instanceof ApiError && error\.status === 404/, '404 may prove absence');
assert.doesNotMatch(
  api,
  /catch\s*\([^)]*\)\s*\{\s*return \{ kind: 'absent' \}/,
  'generic failure must never become absence',
);

assert.match(state, /status: 'not_created'/, 'absence must be a dedicated state');
assert.match(state, /status: 'stale'/, 'soft refresh failure must preserve visible plan as stale');
assert.match(state, /state\.status === 'stale'/, 'stale state must be handled by action policy');
assert.match(state, /return NO_ACTIONS/, 'error and stale states must fail closed');
assert.match(state, /if \(event\.contextKey !== machine\.contextKey\) return machine/, 'old-project responses must be ignored');

assert.match(hook, /generationRef/, 'loader must reject out-of-order responses');
assert.match(hook, /abortRef\.current\?\.abort\(\)/, 'loader must cancel obsolete requests');
assert.match(hook, /api\.fetchActiveSchedulePlan/, 'loader must consume explicit truth result');

assert.match(screen, /planActions\.canCreate/, 'create CTA must use state-machine permission');
assert.match(screen, /planState\.status === 'error'/, 'screen must render load error explicitly');
assert.match(screen, /planState\.status === 'stale'/, 'screen must render stale state explicitly');
assert.match(screen, /Повторить загрузку/, 'screen must provide retry for retryable error');
assert.doesNotMatch(screen, /getActiveWorkSchedule[\s\S]{0,200}setSchedule\(null\)/, 'load failure must never erase truth into not-created');
assert.doesNotMatch(screen, /!schedule \? \(/, 'schedule null alone must not authorize create');

console.log('schedulePlanTruthIntegrity.test OK');
