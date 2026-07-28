import {
  KNOWN_LEGACY_SLUGS,
  legacySlugRedirect,
  resolveCatchAllSlug,
  roleAwareRegistryRedirect,
} from './resolveCatchAllSlug';

const stack = new Set(['reports', 'guide']);

const pa = resolveCatchAllSlug('project-analytics', 'customer', stack);
if (pa.kind !== 'redirect') throw new Error('project-analytics must redirect');

const nf = resolveCatchAllSlug('totally-unknown-xyz', 'contractor', stack);
if (nf.kind !== 'not_found') throw new Error('unknown must 404');

const st = resolveCatchAllSlug('reports', 'customer', stack);
if (st.kind !== 'stack') throw new Error('reports stack');

for (const slug of KNOWN_LEGACY_SLUGS) {
  const r = resolveCatchAllSlug(slug, 'customer', stack);
  if (r.kind !== 'redirect') throw new Error(`${slug} should redirect`);
}

// P0: materials/selections — role-prefixed, не bare /repair?...
for (const role of ['customer', 'contractor'] as const) {
  const mat = legacySlugRedirect('materials-procurement', role);
  if (!mat || typeof mat === 'string') throw new Error(`materials ${role} must be OsTabRoute`);
  if (!mat.pathname.includes(`/(${role})/(tabs)/repair`)) {
    throw new Error(`materials ${role} path=${mat.pathname}`);
  }
  if (mat.params?.tab !== 'materials' || mat.params?.subtab !== 'purchases') {
    throw new Error(`materials ${role} params=${JSON.stringify(mat.params)}`);
  }
  const sel = legacySlugRedirect('selections', role);
  if (!sel || typeof sel === 'string') throw new Error(`selections ${role} must be OsTabRoute`);
  if (!sel.pathname.includes(`/(${role})/(tabs)/repair`) || sel.params?.tab !== 'selections') {
    throw new Error(`selections ${role} bad: ${JSON.stringify(sel)}`);
  }
}

const bareRepair = roleAwareRegistryRedirect('/repair?tab=control', 'contractor');
if (
  !bareRepair ||
  typeof bareRepair === 'string' ||
  !bareRepair.pathname.includes('/(contractor)/(tabs)/repair') ||
  bareRepair.params?.tab !== 'control'
) {
  throw new Error(`roleAware bare repair failed: ${JSON.stringify(bareRepair)}`);
}

console.log('resolveCatchAllSlug.test OK');
