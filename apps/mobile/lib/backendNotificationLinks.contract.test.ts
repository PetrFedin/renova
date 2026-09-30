/**
 * Contract: every navigation link the backend generates (link_path / return_to
 * literals in backend/app) must resolve through the client's resolvePushLink
 * into a route that really exists in apps/mobile/app (expo-router file tree).
 * Also pins the "(tabs)/home" regression and the encoded returnTo format.
 *
 * Run: tsx apps/mobile/lib/backendNotificationLinks.contract.test.ts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { OsRole } from '../constants/osSections';
import { resolveNotificationLink, resolvePushLink } from './pushLinks';

const ROOT = join(__dirname, '..', '..', '..');
const BACKEND = join(ROOT, 'backend', 'app');
const APP = join(ROOT, 'apps', 'mobile', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// --- routes that really exist (static files only: [legacyTab] catch-alls do not count) ---
const existing = new Set<string>();
for (const file of walk(APP)) {
  if (!/\.tsx?$/.test(file)) continue;
  const rel = relative(APP, file).split(sep).join('/').replace(/\.tsx?$/, '');
  if (rel.startsWith('_') || rel.startsWith('+')) continue;
  if (rel.endsWith('/[legacyTab]') || rel === '[slug]') continue;
  const route = '/' + rel.replace(/(^|\/)index$/, '');
  existing.add(route);
}
// stack screens re-exported from app/_stack are mounted at the top level
for (const file of walk(join(APP, '_stack'))) {
  existing.add('/' + relative(join(APP, '_stack'), file).split(sep).join('/').replace(/\.tsx?$/, ''));
}
assert.ok(existing.has('/(customer)/(tabs)/budget') && existing.has('/(customer)/(tabs)'), 'route scan sanity');
assert.ok(!existing.has('/(customer)/(tabs)/home'), 'no home tab route');

// --- link literals in backend ---
const pyFiles = walk(BACKEND).filter((f) => f.endsWith('.py'));
const links = new Map<string, string>(); // literal -> first file
const TAB_LITERAL = /f?"(\/\((?:customer|contractor|\{[^}"]+\})\)\/\(tabs\)\/?[^"\s]*)"/g;
const KEYED_LITERAL = /(?:link_path|return_to|link)"?\s*[=:]\s*(?:\(?\s*)?f?"(\/[^"\s]*)"/g;
for (const file of pyFiles) {
  const src = readFileSync(file, 'utf8');
  for (const re of [TAB_LITERAL, KEYED_LITERAL]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (!links.has(m[1])) links.set(m[1], relative(ROOT, file));
    }
  }
}
assert.ok(links.size > 30, `expected many backend links, got ${links.size}`);

function expand(lit: string): Array<{ link: string; role: OsRole }> {
  const roles: OsRole[] = ['customer', 'contractor'];
  return roles
    .filter((r) => !lit.startsWith('/(customer)') || r === 'customer')
    .filter((r) => !lit.startsWith('/(contractor)') || r === 'contractor')
    .map((role) => ({
      role,
      link: lit.replace(/\(\{[^}]+\}\)/, `(${role})`).replace(/\{[^}]+\}/g, 'x1'),
    }));
}

const failures: string[] = [];
for (const [lit, file] of links) {
  if (lit.includes('(tabs)/home')) failures.push(`${file}: ${lit} points at non-existent (tabs)/home`);
  for (const { link, role } of expand(lit)) {
    const target = resolvePushLink(link, '/', role);
    if (!target) { failures.push(`${file}: ${link} -> null`); continue; }
    const path = target.pathname.replace(/\/$/, '') || '/';
    // dynamic segments resolve to their file pattern already (/stage/[id])
    if (!existing.has(path)) failures.push(`${file}: ${link} (${role}) -> ${target.pathname} does not exist`);
  }
}
assert.deepEqual(failures, [], `unresolvable backend links:\n${failures.join('\n')}`);

// --- stored link format: returnTo is percent-encoded, so a query inside it survives ---
const stored = '/stage/s1?projectId=p1&returnTo=/(customer)/(tabs)/repair%3Ftab%3Dcontrol';
const parsed = resolvePushLink(stored, null, 'customer')!;
assert.equal(parsed.pathname, '/stage/[id]');
assert.equal(parsed.params.returnTo, '/(customer)/(tabs)/repair?tab=control');
assert.equal(parsed.params.projectId, 'p1');

// --- notification type resolver only yields existing routes too ---
for (const role of ['customer', 'contractor'] as OsRole[]) {
  for (const type of ['payment_pending', 'payment_confirmed', 'stage_review', 'change_order', 'materials', 'chat_message', 'budget_alert', 'schedule_review', 'document', 'issue', 'approval', 'warranty', 'deadline', 'room_created', 'estimate', 'unknown_type']) {
    const r = resolveNotificationLink(type, role);
    assert.ok(r, `${type}/${role} resolves`);
    assert.ok(existing.has(r!.pathname.replace(/\/$/, '') || '/'), `${type}/${role} -> ${r!.pathname} exists`);
  }
}

console.log(`OK backend notification links contract (${links.size} literals, ${existing.size} routes)`);
