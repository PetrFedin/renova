/**
 * Contract: каждая цель навигации из профиля и FAB («+» → «В черновик») должна
 * быть СТАТИЧЕСКИМ route-файлом в apps/mobile/app. Стек-экран, доступный только через
 * динамические catch-all (`[slug]`, `(contractor)/[tool]`, `(tabs)/[legacyTab]`),
 * при push изнутри приложения даёт Redirect-цикл «Maximum update depth exceeded».
 * Также проверяем: resolvePushLink не переписывает цель, а resolveCatchAllSlug
 * не отправляет её редиректом «на то же место».
 *
 * Run: tsx apps/mobile/lib/profileFabNavTargets.contract.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OsRole } from '../constants/osSections';
import { resolvePushLink } from './pushLinks';
import { resolveCatchAllSlug } from './resolveCatchAllSlug';

const APP = join(__dirname, '..', 'app');
const MOBILE = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(MOBILE, rel), 'utf8');

// Литералы href из мест вызова (проверяются ниже на присутствие в исходниках).
const SOURCES: Array<{ file: string; targets: string[] }> = [
  { file: 'components/screens/profile/ContractorProfileScreen.tsx', targets: ['/subscription', '/audit', '/checklist-templates', '/team-qr'] },
  { file: 'components/renova/AdminHubLink.tsx', targets: ['/admin', '/admin-dashboard', '/articles-admin'] },
  { file: 'components/renova/os/OsQuickFab.tsx', targets: ['/scratchpad'] },
  { file: 'lib/fieldCommsNav.ts', targets: ['/team-qr'] },
  { file: 'lib/context/RenovaContext.tsx', targets: ['/subscription'] },
  { file: 'app/(contractor)/_screens/admin-dashboard.tsx', targets: ['/outbox-dead-letters'] },
];

const roles: OsRole[] = ['customer', 'contractor'];
const all = new Set<string>();
for (const { file, targets } of SOURCES) {
  const src = read(file);
  for (const t of targets) {
    assert.ok(src.includes(`'${t}'`), `${file}: ожидался литерал '${t}'`);
    assert.ok(!src.includes(`'/(contractor)${t}'`), `${file}: '/(contractor)${t}' — группа + динамический [tool] снова даст цикл`);
    all.add(t);
  }
}

for (const target of all) {
  const seg = target.slice(1);
  assert.ok(
    existsSync(join(APP, `${seg}.tsx`)),
    `${target}: нет статического app/${seg}.tsx — иначе catch-all → Maximum update depth`,
  );
  for (const role of roles) {
    const link = resolvePushLink(target, '/profile', role);
    assert.ok(link, `${target}: resolvePushLink вернул null`);
    assert.equal(link!.pathname, target, `${target}: resolvePushLink переписал цель (${role})`);
    // Даже если catch-all всё же сработает — это stack или not_found, но не redirect на себя.
    const r = resolveCatchAllSlug(seg, role, []);
    if (r.kind === 'redirect') {
      const to = typeof r.href === 'string' ? r.href : r.href.pathname;
      assert.notEqual(to, target, `${target}: redirect на то же место`);
    }
  }
}

// Админские экраны обёрнуты AdminGate («Нет доступа»), не белый экран.
for (const k of ['admin', 'admin-dashboard', 'articles-admin', 'audit']) {
  assert.ok(read(`app/${k}.tsx`).includes('AdminGate'), `app/${k}.tsx должен быть под AdminGate`);
}
// Админские пункты профиля показываются только при подтверждённом доступе (UI-027).
assert.ok(read('components/renova/AdminHubLink.tsx').includes("access !== 'granted'"), 'AdminHubLink должен скрываться без подтверждённого доступа');
assert.ok(read('components/screens/profile/ContractorProfileScreen.tsx').includes("adminAccess === 'granted'"), 'Журнал аудита — только при доступе админа');

// Целей-катч-олов больше нет: [tool] не держит собственную MAP.
assert.ok(!/const MAP/.test(read('app/(contractor)/[tool].tsx')), '(contractor)/[tool].tsx не должен держать MAP экранов');

console.log('profileFabNavTargets.contract.test OK');
