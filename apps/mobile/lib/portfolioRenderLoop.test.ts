/**
 * «Портфель проектов» уходил в бесконечную перерисовку.
 *
 * `filterOutJunkProjects(projects)` считался на каждом кадре и стоял в
 * зависимостях эффекта. В ветке «нечего считать» эффект вызывал
 * `setPendingById({})` — каждый раз новый объект, значит новое состояние и
 * новый кадр, на котором список снова менял ссылку. React обрывал это
 * сообщением «Maximum update depth exceeded» — на живом экране их набиралось
 * 349 за одну загрузку.
 *
 * Проверка разбирает исходник: производные списки, стоящие в зависимостях
 * эффектов, должны быть мемоизированы, а сброс состояния — не создавать
 * новую ссылку, когда сбрасывать нечего.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(__dirname, '../components/renova/os/PortfolioProjectsView.tsx');
const src = readFileSync(file, 'utf8');

/** Комментарии выкидываются: иначе проверка ловит собственные пояснения. */
function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const code = stripComments(src);

// 1. Производный список мемоизирован.
if (/const cleanProjects = filterOutJunkProjects\(/.test(code)) {
  throw new Error('cleanProjects снова считается на каждом кадре — эффект зациклится');
}
if (!/const cleanProjects = useMemo\(\(\) => filterOutJunkProjects\(projects\), \[projects\]\)/.test(code)) {
  throw new Error('cleanProjects должен быть useMemo по projects');
}

// 2. Ни один эффект не сбрасывает состояние безусловно новой ссылкой.
for (const call of ['setPendingById({})', 'setCategories([])']) {
  if (code.includes(call)) {
    throw new Error(`${call} создаёт новую ссылку на каждом проходе — нужен функциональный сброс`);
  }
}
if (!code.includes('setPendingById((prev) =>')) throw new Error('сброс pendingById не функциональный');
if (!code.includes('setCategories((prev) =>')) throw new Error('сброс categories не функциональный');

// 3. Список всё ещё стоит в зависимостях — иначе экран перестанет обновляться
//    при смене набора объектов, и починка обернётся другой поломкой.
if (!/\}, \[user\?\.id, cleanProjects\]\)/.test(code)) {
  throw new Error('cleanProjects пропал из зависимостей эффекта — экран перестанет обновляться');
}

console.log('portfolioRenderLoop.test OK');
