/**
 * #317: у производителей с устойчивым ключом офлайн-очередь обязана быть
 * достижима, а у остальных — нет, пока повтор небезопасен (#316).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const apiDir = join(__dirname, 'api');
const src = (name: string) => readFileSync(join(apiDir, name), 'utf8');

function producer(source: string, name: string): string {
  const start = source.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`не найден производитель ${name}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n  \w+:/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Операции с устойчивым client_request_id — повтор безопасен. */
const REACHABLE: [string, string][] = [
  ['receipts.ts', 'addManualReceipt'],
  ['receipts.ts', 'scanReceipt'],
  ['chats.ts', 'sendChatMessage'],
];

for (const [file, name] of REACHABLE) {
  const body = producer(src(file), name);
  if (!body.includes('client_request_id')) {
    throw new Error(`${file}::${name} потерял устойчивый ключ — повтор стал небезопасным`);
  }
  if (!body.includes('isAmbiguousWriteFailure(')) {
    throw new Error(`${file}::${name} не пользуется общей классификацией — очередь недостижима`);
  }
  if (/if \((?:error|e) instanceof ApiError\) throw/.test(body)) {
    throw new Error(`${file}::${name} по-прежнему отбрасывает любую ApiError`);
  }
  if (!body.includes('enqueue(')) throw new Error(`${file}::${name} перестал ставить в очередь`);
}

/**
 * Остальные производители пока обязаны отказывать: их повтор небезопасен,
 * пока у операции нет ключа (#316). Число фиксируем, чтобы «починка» одного
 * из них без ключа не прошла незамеченной.
 */
import { readdirSync } from 'fs';

/** Комментарии — не код: пояснение к правилу не должно считаться нарушением. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

let strictGuards = 0;
for (const name of readdirSync(apiDir)) {
  if (!name.endsWith('.ts') || name.includes('.test.')) continue;
  const matches = stripComments(src(name)).match(/if \((?:error|e) instanceof ApiError\) throw/g);
  strictGuards += matches ? matches.length : 0;
}
const EXPECTED_STRICT_GUARDS = 27;
if (strictGuards !== EXPECTED_STRICT_GUARDS) {
  throw new Error(
    `производителей с жёстким отказом ${strictGuards}, в контракте записано ${EXPECTED_STRICT_GUARDS}. ` +
      'Если очередь открыли ещё кому-то — убедитесь, что у операции есть устойчивый ключ (#316), и обновите число.',
  );
}

console.log(`offlineEnqueueContract.test OK (открыто ${REACHABLE.length}, закрыто ${strictGuards})`);
