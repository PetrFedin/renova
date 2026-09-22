/**
 * Типы уведомлений сервера должны разбираться клиентом. Этот разбор —
 * запасной путь: он срабатывает, когда у уведомления нет link_path
 * (NotificationCenter). Неизвестный тип уводит во «Входящие» вместо места,
 * о котором уведомление говорит.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { resolveNotificationLink } from './pushLinks';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');

function serverTypes(): Set<string> {
  const found = new Set<string>();
  const stack = [join(repo, 'backend', 'app')];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (name.endsWith('.py')) {
        const src = readFileSync(full, 'utf8');
        for (const m of src.matchAll(/"notification_type":\s*"([a-z_]+)"/g)) found.add(m[1]);
        for (const m of src.matchAll(/notification_type\s*=\s*"([a-z_]+)"/g)) found.add(m[1]);
      }
    }
  }
  return found;
}

const source = readFileSync(join(mobile, 'lib', 'pushLinks.ts'), 'utf8');
const block = source.split('export function resolveNotificationLink')[1] ?? '';
const handled = new Set([...block.matchAll(/case '([a-z_]+)'/g)].map((m) => m[1]));

const types = serverTypes();
if (types.size < 15) throw new Error(`не удалось прочитать типы уведомлений: ${types.size}`);

const missing = [...types].filter((t) => !handled.has(t)).sort();
if (missing.length) {
  throw new Error(`типы уведомлений сервера без разбора в клиенте: ${missing.join(', ')}`);
}

/** Разбор обязан вести на существующий экран, а не «куда-нибудь». */
for (const type of types) {
  for (const role of ['customer', 'contractor'] as const) {
    const target = resolveNotificationLink(type, role);
    if (!target) throw new Error(`тип «${type}» не дал маршрута для роли ${role}`);
    if (!target.pathname.startsWith('/')) throw new Error(`тип «${type}»: странный путь ${target.pathname}`);
  }
}

// «other» — общий тип, для него входящие и есть верный ответ.
if (resolveNotificationLink('other', 'customer')?.pathname !== '/inbox') {
  throw new Error('общий тип уведомления должен вести во «Входящие»');
}

console.log(`notificationTypesCovered.test OK (типов: ${types.size})`);
