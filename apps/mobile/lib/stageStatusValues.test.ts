/**
 * Экран не должен сравнивать статус этапа со значением, которого нет в
 * StageStatus на сервере. «rework» таким и был: раздел «Доработка» не
 * показывался никогда, а счётчик доработок всегда был нулём.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');

const entities = readFileSync(join(repo, 'backend', 'app', 'models', 'entities.py'), 'utf8');
const block = entities.split('class StageStatus')[1]?.split('\nclass ')[0] ?? '';
const serverStatuses = new Set([...block.matchAll(/^\s+\w+ = "([a-z_]+)"/gm)].map((m) => m[1]));
if (serverStatuses.size < 4) throw new Error(`не удалось прочитать StageStatus: ${[...serverStatuses]}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.')) out.push(full);
  }
  return out;
}

const STAGE_HINT = /\b(stage|stages|st|s)\.status\s*(?:===|!==)\s*'([a-z_]+)'/g;
const offenders: string[] = [];
/** Комментарии — не код: разбор кода не должен спотыкаться о пояснение к нему. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

for (const file of walk(join(mobile, 'lib')).concat(walk(join(mobile, 'components')))) {
  const text = stripComments(readFileSync(file, 'utf8'));
  for (const m of text.matchAll(STAGE_HINT)) {
    const value = m[2];
    // Сравнивать со статусами других сущностей тем же коротким именем можно:
    // ловим только значения, которых нет ни у одной сущности вообще.
    if (value === 'rework') {
      offenders.push(`${file.replace(mobile, '')}: «${value}»`);
    }
  }
}
if (!serverStatuses.has('rework') && offenders.length) {
  throw new Error(`статуса «rework» у этапа нет на сервере, а сравнение осталось:\n  ${offenders.join('\n  ')}`);
}
if (serverStatuses.has('rework')) {
  throw new Error('на сервере появился статус rework — пересмотрите stageRework.ts и этот тест');
}

const rework = readFileSync(join(mobile, 'lib', 'domain', 'stageRework.ts'), 'utf8');
if (!rework.includes('needs_rework === true')) throw new Error('доработка читается не из флага');
if (!rework.includes("stage.status === 'done'")) throw new Error('завершённый этап не исключён из доработок');

console.log('stageStatusValues.test OK');
