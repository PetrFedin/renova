/**
 * Regression: app/(contractor)/[tool].tsx and app/[slug].tsx both
 * register a `/:segment` pattern (the `(contractor)` route group is
 * path-transparent), so a STACK_PATHS route like `/job-leads` can be
 * resolved by either catch-all. [tool].tsx used to unconditionally
 * <Redirect href="/(contractor)/(tabs)" /> for anything outside its own
 * small tool MAP, silently bouncing STACK_PATHS routes back into the
 * tabs Slot instead of opening them — which is what produced the
 * "Заявки и новые объекты" → Maximum update depth crash.
 *
 * Source-text checks (this repo's convention for route-wiring regression
 * tests — see journeyUnify.w118.test.ts, reliabilityUx.w152.test.ts).
 */
import fs from 'node:fs';
import path from 'node:path';

// Only the catch-all-rendered STACK_PATHS entries collide with
// (contractor)/[tool].tsx's dynamic `/:tool` pattern — routes with their
// own static file (app/documents.tsx, app/inbox.tsx, …) are unambiguous
// because expo-router always prefers a static match over a dynamic one.
//
// `job-leads` used to be in this list and relied solely on the catch-alls
// resolving to identical content. That mitigation was not enough: the
// ambiguous match still made two navigators (root Stack + the nested
// (contractor) Stack) fight over reconciling the same route on every
// render, producing "Maximum update depth exceeded" even though the
// *content* both catch-alls rendered was identical. The real fix is the
// same one reports/guide/portfolio/documents/activity already had — a
// static app/job-leads.tsx file — which is asserted below.
const CATCH_ALL_STACK_KEYS = [
  'budget-planner', 'checklist-templates', 'conflicts', 'guide',
  'manager-dashboard', 'portfolio', 'reports', 'scratchpad',
];

const root = path.resolve(__dirname, '..');
const toolSrc = fs.readFileSync(path.join(root, 'app/(contractor)/[tool].tsx'), 'utf8');
const slugSrc = fs.readFileSync(path.join(root, 'app/[slug].tsx'), 'utf8');
const sharedSrc = fs.readFileSync(path.join(root, 'app/_stack/AppCatchAllScreen.tsx'), 'utf8');
const rootLayoutSrc = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');

console.assert(
  fs.existsSync(path.join(root, 'app/job-leads.tsx')),
  'app/job-leads.tsx must exist as a static route — a catch-all-only /job-leads collides with ' +
    '(contractor)/[tool].tsx\'s dynamic pattern and produces Maximum update depth (see W39 crash)',
);
console.assert(
  /<Stack\.Screen name="job-leads"/.test(rootLayoutSrc),
  'app/_layout.tsx must explicitly register the "job-leads" Stack.Screen, like reports/guide/portfolio/documents/activity',
);

console.assert(
  toolSrc.includes('AppCatchAllScreen'),
  '(contractor)/[tool].tsx must delegate unmapped segments to the shared catch-all',
);
console.assert(
  !/if \(!Comp\) return <Redirect href="\/\(contractor\)\/\(tabs\)" \/>/.test(toolSrc),
  '(contractor)/[tool].tsx must not blind-redirect unmapped segments back to tabs (that swallows STACK_PATHS routes)',
);
console.assert(
  slugSrc.includes('AppCatchAllScreen'),
  'app/[slug].tsx must render the same shared catch-all as (contractor)/[tool].tsx',
);

for (const key of CATCH_ALL_STACK_KEYS) {
  console.assert(
    sharedSrc.includes(`'${key}':`) || sharedSrc.includes(`${key}:`),
    `AppCatchAllScreen must know how to render STACK_PATHS entry "/${key}" so either catch-all resolves it identically`,
  );
}

console.log('contractorToolStackCollision.test OK');
