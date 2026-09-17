#!/usr/bin/env node
/**
 * The two calc-engine copies must stay byte-identical.
 *
 * README.md names `packages/calc-engine` as the shared estimate engine
 * ("Расчёты — packages/calc-engine (TypeScript, общий с mobile)"). It was not.
 * Nothing imported it — `grep -rn "@renova/calc-engine" apps backend scripts
 * e2e` returned nothing — and it had drifted into a frozen, smaller snapshot of
 * `apps/mobile/lib/calc-engine`: templates.ts 51 lines against 355,
 * estimate.ts 58 against 99, plus 8 modules missing entirely.
 *
 * The mobile copy is the one the product actually runs (wizard/confirm,
 * contractor-wizard, budget-planner, CreateWorkSheet, roomMetrics), so it is
 * the source of truth and the package is synced from it. This guard fails the
 * build the moment they diverge again, which is the property the README
 * claimed but nothing enforced.
 *
 * Making mobile import from the package instead of holding its own copy is the
 * next step and a separate change: it touches real import paths in shipping
 * screens and deserves its own review.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE_DIR = 'packages/calc-engine/src';
const MOBILE_DIR = 'apps/mobile/lib/calc-engine';

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name)
    .sort();
}

const packageFiles = listFiles(PACKAGE_DIR);
const mobileFiles = listFiles(MOBILE_DIR);

const problems = [];

const onlyInPackage = packageFiles.filter((name) => !mobileFiles.includes(name));
const onlyInMobile = mobileFiles.filter((name) => !packageFiles.includes(name));

for (const name of onlyInPackage) {
  problems.push(`${name}: present in ${PACKAGE_DIR} but not in ${MOBILE_DIR}`);
}
for (const name of onlyInMobile) {
  problems.push(`${name}: present in ${MOBILE_DIR} but not in ${PACKAGE_DIR}`);
}

for (const name of packageFiles.filter((file) => mobileFiles.includes(file))) {
  const fromPackage = readFileSync(join(PACKAGE_DIR, name), 'utf8');
  const fromMobile = readFileSync(join(MOBILE_DIR, name), 'utf8');
  if (fromPackage !== fromMobile) {
    problems.push(`${name}: contents differ between the two copies`);
  }
}

if (problems.length > 0) {
  console.error('calc-engine copies have diverged:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  console.error(`The mobile copy is authoritative; sync with:`);
  console.error(`  cp ${MOBILE_DIR}/*.ts ${PACKAGE_DIR}/`);
  process.exit(1);
}

console.log(`calc-engine single source OK (${packageFiles.length} files identical)`);
