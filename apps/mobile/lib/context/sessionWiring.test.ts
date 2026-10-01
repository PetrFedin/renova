/** Проводка сессии в контексте/экранах (CMP-002/003/008/009/015/016/017) — статические инварианты. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};
const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

const ctx = read('lib/context/RenovaContext.tsx');
const banner = read('components/renova/DataStatusBanner.tsx');
const portal = read('components/screens/PortalScreen.tsx');
const layout = read('app/_layout.tsx');

// CMP-002/003: хуки клиента зарегистрированы, запись токенов под фенсом
must(ctx.includes('setSessionHooks({'), 'context registers session hooks');
const rot = ctx.slice(ctx.indexOf('onTokensRotated'), ctx.indexOf('onSessionExpired'));
must(rot.includes('getSessionStamp().generation !== stamp.generation'), 'rotation persist is fenced');
must(rot.includes('secureSet(KEYS.refreshToken') && rot.includes('secureSet(KEYS.accessToken'), 'both tokens persisted');
must(ctx.includes('Сессия истекла. Войдите снова') && ctx.includes("router.replace('/onboarding/role'"), 'expiry shows notice and login screen');

// CMP-008: «Повторить» не зовёт demo-login; демо — только явно и при EXPO_PUBLIC_DEMO
const recover = ctx.slice(ctx.indexOf('const recoverSession = useCallback'), ctx.indexOf('const recoverDemo = useCallback'));
must(!recover.includes('recoverDemoSession') && !recover.includes('demoLogin'), 'recoverSession must not demo-login');
const demo = ctx.slice(ctx.indexOf('const recoverDemo = useCallback'), ctx.indexOf('const recoverDemo = useCallback') + 400);
must(demo.includes('isDemoEnabled()'), 'explicit demo recovery is gated by EXPO_PUBLIC_DEMO');
must(ctx.includes('isDemoEnabled() && (isDemoPhone'), 'cold-start demo recovery is gated');
must(!banner.includes('__DEV__'), 'banner demo gate must not rely on __DEV__');
must(banner.includes("label: 'Демо', onPress: recoverDemo"), 'demo button uses explicit demo recovery');
must(banner.includes("label: 'Повторить', onPress: recoverSession"), 'retry uses plain reload');

// CMP-016: выход чистит кэш и очередь вышедшего
const logoutBody = ctx.slice(ctx.indexOf('const logout = useCallback'), ctx.indexOf('logoutRef.current = logout'));
must(logoutBody.includes('clearAllCachedGets()'), 'logout clears durable GET cache');
must(logoutBody.includes('dropJobsForUser(stamp.userId)'), 'logout drops only the leaving user queue');

// CMP-009/017: портал не пишет в глобальный токен
must(!portal.includes('setAccessToken'), 'portal must not replace the global access token');
must(portal.includes('registerPortalBearer(') && portal.includes('unregisterPortalBearer?.()'), 'portal bearer is scoped to the screen');

// CMP-015: планировщик запущен
must(layout.includes('startOfflineFlushScheduler(') && layout.includes('stopFlushScheduler()'), 'flush scheduler started and stopped');

console.log('sessionWiring.test OK');
