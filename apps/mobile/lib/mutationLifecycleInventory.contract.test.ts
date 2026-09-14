import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RENOVA_ROUTES } from './routeRegistry';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const apiDir = resolve(here, 'api');
const inventoryPath = resolve(repoRoot, 'docs/technical-spec/MUTATION-LIFECYCLE-AND-LATENT-CAPABILITY-INVENTORY.md');

/**
 * Classification is intentionally module-level. The annex is the human-readable
 * lifecycle matrix; this list prevents a new mutating API surface from bypassing it.
 */
const CLASSIFIED_API_MODULES = new Set([
  'admin',
  'auth',
  'calendar',
  'chats',
  'design',
  'documents',
  'estimate',
  'floor',
  'issues',
  'market',
  'materials',
  'misc',
  'notifications',
  'os',
  'payments',
  'projects',
  'receipts',
  'rooms',
  'scratchpad',
  'selections',
  'stages',
  'technicalSupervision',
  'workAcceptances',
  'workOrders',
  'workSchedule',
]);

type LatentClassification =
  | 'EXPOSE_NOW'
  | 'EXPOSE_AFTER_FIX'
  | 'DEEPLINK_BY_DESIGN'
  | 'REDIRECT_BY_DESIGN'
  | 'OPERATOR_INTERNAL'
  | 'LEGACY_RETIRE';

const LATENT_ROUTE_CLASSIFICATION: Record<string, LatentClassification> = {
  calendar: 'DEEPLINK_BY_DESIGN',
  'finance-center': 'REDIRECT_BY_DESIGN',
  control: 'REDIRECT_BY_DESIGN',
  'quality-control': 'DEEPLINK_BY_DESIGN',
  'work-acceptance': 'REDIRECT_BY_DESIGN',
  'work-schedule': 'REDIRECT_BY_DESIGN',
  notifications: 'REDIRECT_BY_DESIGN',
  'scan-receipt': 'DEEPLINK_BY_DESIGN',
  stage: 'DEEPLINK_BY_DESIGN',
  'materials-procurement': 'REDIRECT_BY_DESIGN',
  selections: 'REDIRECT_BY_DESIGN',
  'warranty-claim': 'DEEPLINK_BY_DESIGN',
  design: 'REDIRECT_BY_DESIGN',
  conflicts: 'DEEPLINK_BY_DESIGN',
  portfolio: 'DEEPLINK_BY_DESIGN',
  scratchpad: 'DEEPLINK_BY_DESIGN',
  'budget-planner': 'DEEPLINK_BY_DESIGN',
  'checklist-templates': 'DEEPLINK_BY_DESIGN',
  guide: 'DEEPLINK_BY_DESIGN',
  portal: 'DEEPLINK_BY_DESIGN',
  'project-analytics': 'REDIRECT_BY_DESIGN',
};

const inventory = readFileSync(inventoryPath, 'utf8');
const apiIndex = readFileSync(resolve(apiDir, 'index.ts'), 'utf8');
const mutationPattern = /method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/;

const mutatingModules = readdirSync(apiDir)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .filter((name) => mutationPattern.test(readFileSync(resolve(apiDir, name), 'utf8')))
  .map((name) => name.replace(/\.ts$/, ''))
  .sort();

const unclassifiedMutatingModules = mutatingModules.filter((name) => !CLASSIFIED_API_MODULES.has(name));
if (unclassifiedMutatingModules.length) {
  throw new Error(
    `Mutating mobile API modules missing lifecycle classification: ${unclassifiedMutatingModules.join(', ')}`,
  );
}

for (const moduleName of CLASSIFIED_API_MODULES) {
  if (!apiIndex.includes(`from './${moduleName}'`)) {
    throw new Error(`Classified API module is no longer exported by api/index.ts: ${moduleName}`);
  }
  if (!inventory.includes(`\`${moduleName}.ts\``)) {
    throw new Error(`Lifecycle inventory missing API module documentation: ${moduleName}.ts`);
  }
}

const latentRoutes = RENOVA_ROUTES
  .filter((route) => route.visibility === 'hidden' || route.visibility === 'deeplink')
  .map((route) => route.id)
  .sort();
const classifiedLatentRoutes = Object.keys(LATENT_ROUTE_CLASSIFICATION).sort();

const missingRouteClassifications = latentRoutes.filter((id) => !(id in LATENT_ROUTE_CLASSIFICATION));
const staleRouteClassifications = classifiedLatentRoutes.filter((id) => !latentRoutes.includes(id));
if (missingRouteClassifications.length || staleRouteClassifications.length) {
  throw new Error(
    `Latent route inventory drift. missing=[${missingRouteClassifications.join(', ')}] stale=[${staleRouteClassifications.join(', ')}]`,
  );
}

for (const [routeId, classification] of Object.entries(LATENT_ROUTE_CLASSIFICATION)) {
  if (!inventory.includes(`\`${routeId}\``) || !inventory.includes(`\`${classification}\``)) {
    throw new Error(`Latent route ${routeId} (${classification}) is not documented in the inventory`);
  }
}

for (const capability of ['projectsApi.getContractorAnalytics()', 'projectsApi.getAnalytics()']) {
  if (!inventory.includes(`\`${capability}\``)) {
    throw new Error(`Code-only capability is missing inventory classification: ${capability}`);
  }
}

if (!inventory.includes('e5c6ee44c0f684b14037e77948dbcb630fd41896')) {
  throw new Error('Mutation lifecycle inventory must name the exact audited main SHA');
}

console.log('mutationLifecycleInventory.contract.test OK', {
  mutatingModules: mutatingModules.length,
  latentRoutes: latentRoutes.length,
});
