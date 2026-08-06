import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HUB_TAB_SYNC_RETRY_DELAYS_MS,
  isHubNavigationReady,
  isRootLayoutMountRace,
} from './hubTabNavigation';

if (isHubNavigationReady({ current: null })) {
  throw new Error('unmounted navigation container must not be ready');
}
if (isHubNavigationReady({ current: { isReady: () => false } })) {
  throw new Error('mounting navigation container must not be ready');
}
if (!isHubNavigationReady({ current: { isReady: () => true } })) {
  throw new Error('mounted navigation container must be ready');
}
if (HUB_TAB_SYNC_RETRY_DELAYS_MS.length < 5) {
  throw new Error('hub URL sync must retry across the root mount window');
}
for (let index = 1; index < HUB_TAB_SYNC_RETRY_DELAYS_MS.length; index += 1) {
  if (HUB_TAB_SYNC_RETRY_DELAYS_MS[index] < HUB_TAB_SYNC_RETRY_DELAYS_MS[index - 1]) {
    throw new Error('hub URL sync retry delays must be monotonic');
  }
}

const mountRace = new Error(
  'Attempted to navigate before mounting the Root Layout component. Ensure the Root Layout component is rendering a Slot.',
);
if (!isRootLayoutMountRace(mountRace)) {
  throw new Error('known Expo Router root mount race must be retryable');
}
if (isRootLayoutMountRace(new Error('route parameter is invalid'))) {
  throw new Error('unexpected router errors must not be hidden as mount races');
}
if (isRootLayoutMountRace('Attempted to navigate before mounting the Root Layout component')) {
  throw new Error('non-Error values must not be classified as the known router race');
}

const hook = readFileSync(join(__dirname, 'useHubTab.ts'), 'utf8');
const required = [
  'useNavigationContainerRef',
  'isHubNavigationReady(navigationRef)',
  'HUB_TAB_SYNC_RETRY_DELAYS_MS',
  'pendingTabRef',
  'mountedRef',
  'isRootLayoutMountRace(error)',
  "reportError('lib.useHubTab.syncTabParam', error)",
];
for (const token of required) {
  if (!hook.includes(token)) throw new Error(`useHubTab mount-race contract missing: ${token}`);
}
if (hook.includes('useRootNavigationState')) {
  throw new Error('root state key is not a safe NavigationContainer readiness signal');
}
if (hook.includes("import { router,")) {
  throw new Error('hub URL sync must use its mounted router hook, not the global singleton');
}
if (hook.indexOf('isHubNavigationReady(navigationRef)') > hook.indexOf('router.setParams')) {
  throw new Error('navigation readiness must be checked before setParams');
}

console.log('hub tab navigation mount-race contracts OK');
