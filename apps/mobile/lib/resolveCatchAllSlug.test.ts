import { KNOWN_LEGACY_SLUGS, resolveCatchAllSlug } from './resolveCatchAllSlug';

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

console.log('resolveCatchAllSlug.test OK');
