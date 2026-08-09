import { readFileSync } from 'node:fs';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const src = readFileSync('apps/mobile/lib/sessionBootstrap.ts', 'utf8');

must(
  src.includes('throw lastError;'),
  'project-list retry exhaustion must throw instead of becoming a successful empty list',
);
must(
  !/listProjectsWithRetry[\s\S]{0,800}return \[\];/.test(src),
  'listProjectsWithRetry must distinguish a real empty API response from exhausted failures',
);

const recoverStart = src.indexOf('export async function recoverDemoSession');
const recoverEnd = src.indexOf('/** Автовход для preview', recoverStart);
const recover = src.slice(recoverStart, recoverEnd);
const listAt = recover.indexOf('const list = await listProjectsWithRetry');
const persistAt = recover.indexOf('await AsyncStorage.multiSet');
must(listAt >= 0 && persistAt > listAt, 'demo identity must be persisted only after project reconciliation succeeds');

const previewStart = src.indexOf('export async function bootstrapPreviewDemo');
const preview = src.slice(previewStart);
const recoverAt = preview.indexOf("const recovered = await recoverDemoSession('customer');");
const doneAt = preview.indexOf("['renova_detail_quiz_done', '1']");
must(recoverAt >= 0 && doneAt > recoverAt, 'preview onboarding completion must happen only after demo recovery succeeds');
must(preview.includes('if (!recovered) return null;'), 'failed preview recovery must not mark onboarding complete');

console.log('sessionBootstrapFailClosed.w181.test OK');
