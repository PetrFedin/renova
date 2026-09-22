/**
 * Каждая ссылка, которую сервер кладёт в уведомление или ленту, обязана
 * разбираться в существующий экран. Иначе нажатие на уведомление уводит
 * в никуда, и узнать об этом можно только от человека.
 *
 * Сами ссылки читаются из исходников backend, а список экранов — из дерева
 * app/: тест сверяет две реальности, а не мою память о них.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { resolvePushLink } from './pushLinks';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const appDir = join(mobile, 'app');

function walk(dir: string, prefix = '', out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, `${prefix}/${name}`, out);
    else if (name.endsWith('.tsx') && !name.startsWith('_') && !name.startsWith('+')) {
      const base = name.replace(/\.tsx$/, '');
      out.push(base === 'index' ? `${prefix}/` : `${prefix}/${base}`);
    }
  }
  return out;
}

const routes = new Set(walk(appDir));
for (const r of [...routes]) if (r.endsWith('/')) routes.add(r.slice(0, -1));
if (routes.size < 30) throw new Error(`не удалось прочитать маршруты приложения: ${routes.size}`);

function backendLinks(): string[] {
  const found = new Set<string>();
  const stack = [join(repo, 'backend', 'app')];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (name.endsWith('.py')) {
        const src = readFileSync(full, 'utf8');
        for (const m of src.matchAll(/"(?:link_path|return_to)":\s*f?"([^"]+)"/g)) found.add(m[1]);
        for (const m of src.matchAll(/(?:link_path|return_to)\s*=\s*f?"([^"]+)"/g)) found.add(m[1]);
      }
    }
  }
  return [...found].filter((p) => p.startsWith('/') && !p.startsWith('/api/'));
}

const links = backendLinks();
if (links.length < 20) throw new Error(`не удалось прочитать ссылки сервера: ${links.length}`);

const broken: string[] = [];
for (const raw of links) {
  // Подстановки f-строк: роль важна, остальное — любой идентификатор.
  const link = raw.replace(/\{[^}]*role[^}]*\}/g, 'customer').replace(/\{[^}]*\}/g, 'abc-123');
  for (const role of ['customer', 'contractor'] as const) {
    const target = resolvePushLink(link, '/origin', role);
    if (!target) { broken.push(`${raw} [${role}] → null`); continue; }
    const known = routes.has(target.pathname) || target.pathname.includes('[');
    if (!known) broken.push(`${raw} [${role}] → ${target.pathname}`);
    if (target.params.returnTo !== '/origin' && !raw.includes('returnTo')) {
      broken.push(`${raw} [${role}] потерял returnTo`);
    }
  }
}

if (broken.length) {
  throw new Error(`ссылки сервера не ведут на существующий экран:\n  ${broken.join('\n  ')}`);
}

console.log(`serverLinksResolve.test OK (ссылок: ${links.length}, экранов: ${routes.size})`);
