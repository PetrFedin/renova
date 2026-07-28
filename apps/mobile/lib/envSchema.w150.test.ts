/** W150: mobile env schema — release fail-fast, no private EXPO_PUBLIC_* */
import { validateMobileEnv, assertNoPrivateSecretsInPublicEnv } from './envSchema';

function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const dev = validateMobileEnv({
  EXPO_PUBLIC_APP_ENV: 'development',
  EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8100',
  EXPO_PUBLIC_DEMO: '1',
});
must(dev.ok, 'development should allow localhost fallbacks');

const badProd = validateMobileEnv({
  EXPO_PUBLIC_APP_ENV: 'production',
  EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8100',
  EXPO_PUBLIC_DEMO: '0',
});
must(!badProd.ok, 'production must reject localhost API');
must(
  badProd.errors.every((e) => !e.includes('http://')),
  'errors must not echo URL values',
);

const okProd = validateMobileEnv({
  EXPO_PUBLIC_APP_ENV: 'production',
  EXPO_PUBLIC_API_URL: 'https://api.example.com',
  EXPO_PUBLIC_DEMO: '0',
  EXPO_PUBLIC_SENTRY_APPROVED_WITHOUT_DSN: 'true',
});
must(okProd.ok, 'production ok with https + sentry exception');

const leaked = assertNoPrivateSecretsInPublicEnv({
  EXPO_PUBLIC_SECRET_KEY: 'nope',
} as Record<string, string>);
must(leaked.includes('EXPO_PUBLIC_SECRET_KEY'), 'flag private secret in public env');

console.log('envSchema.w150.test.ts OK');
