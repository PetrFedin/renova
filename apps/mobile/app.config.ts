/**
 * Динамическая конфигурация Expo поверх статического `app.json`.
 *
 * `app.json` остаётся базой (версия, buildNumber/versionCode, иконки, плагины): его читают
 * eas-build.yml, production_readiness.py, testflight-preflight.sh и тесты. Здесь поверх него
 * накладываются значения из окружения, которые владелец вписывает ОДИН раз (EAS secrets /
 * переменные CI / локальный shell) без правки кода.
 *
 * Переменные (все необязательны локально; для store-профилей см. assertReleaseReady):
 *   RENOVA_APP_ENV            development | staging | production (иначе EXPO_PUBLIC_APP_ENV)
 *   RENOVA_IOS_BUNDLE_ID      по умолчанию — значение из app.json (ru.renova.app)
 *   RENOVA_ANDROID_PACKAGE    нет значения по умолчанию: идентификатор публикуется навсегда
 *   RENOVA_EAS_OWNER          аккаунт/организация Expo
 *   RENOVA_EAS_PROJECT_ID     UUID проекта EAS (`eas init`)
 *   RENOVA_API_URL_DEVELOPMENT | RENOVA_API_URL_STAGING | RENOVA_API_URL_PRODUCTION
 *   EXPO_PUBLIC_API_URL       имеет приоритет над RENOVA_API_URL_* (так задаёт eas.json)
 *   RENOVA_EXPORT_COMPLIANCE_EXEMPT  true/false -> ITSAppUsesNonExemptEncryption = !exempt;
 *                             не задано -> ключ не пишется (вопрос остаётся в App Store Connect)
 *   RENOVA_ALLOW_PLACEHOLDER_CONFIG=1  разрешить сборку store-профиля с PLACEHOLDER (не для релиза)
 *
 * Значения-заглушки содержат слово PLACEHOLDER и нигде не выдают себя за настоящие.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export type AppEnv = 'development' | 'staging' | 'production';

export const PLACEHOLDER_ANDROID_PACKAGE = 'ru.renova.PLACEHOLDER_ANDROID_PACKAGE';
export const PLACEHOLDER_API_HOST = 'PLACEHOLDER-set-RENOVA_API_URL.invalid';

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined): string | undefined => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : undefined;
};

export function resolveAppEnv(env: Env): AppEnv {
  const raw = (clean(env.RENOVA_APP_ENV) ?? clean(env.EXPO_PUBLIC_APP_ENV) ?? 'development').toLowerCase();
  if (raw === 'production' || raw === 'staging' || raw === 'development') return raw;
  throw new Error(`app.config: unsupported app env "${raw}" (development|staging|production)`);
}

export function resolveApiUrl(env: Env, appEnv: AppEnv): string {
  const explicit = clean(env.EXPO_PUBLIC_API_URL);
  if (explicit) return explicit;
  const byProfile = clean(env[`RENOVA_API_URL_${appEnv.toUpperCase()}`]);
  if (byProfile) return byProfile;
  return appEnv === 'development' ? 'http://127.0.0.1:8100' : `https://${PLACEHOLDER_API_HOST}`;
}

export function isPlaceholder(value: string | undefined): boolean {
  return !value || /PLACEHOLDER|\.invalid(\/|$|:)/i.test(value);
}

/** Незаполненные обязательные для релиза значения (пустой список = можно собирать). */
export function releaseGaps(resolved: {
  apiUrl: string;
  androidPackage: string;
  projectId?: string;
  owner?: string;
}): string[] {
  const gaps: string[] = [];
  if (isPlaceholder(resolved.apiUrl)) gaps.push('API URL (RENOVA_API_URL_<ENV> / EXPO_PUBLIC_API_URL)');
  if (isPlaceholder(resolved.androidPackage)) gaps.push('RENOVA_ANDROID_PACKAGE');
  if (!resolved.projectId) gaps.push('RENOVA_EAS_PROJECT_ID');
  if (!resolved.owner) gaps.push('RENOVA_EAS_OWNER');
  return gaps;
}

export function buildConfig(base: Partial<ExpoConfig>, env: Env): ExpoConfig {
  const appEnv = resolveAppEnv(env);
  const baseIos = (base.ios ?? {}) as NonNullable<ExpoConfig['ios']>;
  const baseAndroid = (base.android ?? {}) as NonNullable<ExpoConfig['android']>;
  const baseExtra = (base.extra ?? {}) as Record<string, unknown>;

  const iosBundleId = clean(env.RENOVA_IOS_BUNDLE_ID) ?? baseIos.bundleIdentifier;
  const androidPackage = clean(env.RENOVA_ANDROID_PACKAGE) ?? baseAndroid.package ?? PLACEHOLDER_ANDROID_PACKAGE;
  const owner = clean(env.RENOVA_EAS_OWNER) ?? base.owner;
  const projectId = clean(env.RENOVA_EAS_PROJECT_ID) ?? (baseExtra.eas as { projectId?: string } | undefined)?.projectId;
  const apiUrl = resolveApiUrl(env, appEnv);

  const infoPlist: Record<string, unknown> = { ...(baseIos.infoPlist ?? {}) };
  const exempt = clean(env.RENOVA_EXPORT_COMPLIANCE_EXEMPT)?.toLowerCase();
  if (exempt === 'true' || exempt === 'false') {
    // Только стандартный HTTPS/TLS -> «освобождённое» шифрование -> ключ false.
    infoPlist.ITSAppUsesNonExemptEncryption = exempt !== 'true';
  }

  // expo-camera: плагин + CAMERA; микрофон камере не нужен -> RECORD_AUDIO блокируем.
  const plugins = [...(base.plugins ?? [])];
  const hasCamera = plugins.some((p) => (Array.isArray(p) ? p[0] : p) === 'expo-camera');
  if (!hasCamera) {
    plugins.push([
      'expo-camera',
      {
        cameraPermission: 'Renova использует камеру для фото документов, чеков и QR-кодов команды.',
        recordAudioAndroid: false,
      },
    ]);
  }
  const permissions = Array.from(new Set([...(baseAndroid.permissions ?? []), 'CAMERA']));
  const blocked = Array.from(new Set([...(baseAndroid.blockedPermissions ?? []), 'android.permission.RECORD_AUDIO']));

  const gaps = releaseGaps({ apiUrl, androidPackage, projectId, owner });
  const profile = clean(env.EAS_BUILD_PROFILE);
  const storeProfile = profile === 'production' || profile === 'testflight';
  if (storeProfile && gaps.length > 0 && env.RENOVA_ALLOW_PLACEHOLDER_CONFIG !== '1') {
    throw new Error(
      `app.config: профиль "${profile}" нельзя собирать с незаполненными значениями: ${gaps.join(', ')}. ` +
        'См. docs/INTEGRATIONS.md (мобильное приложение).',
    );
  }

  return {
    ...base,
    name: base.name ?? 'Renova',
    slug: base.slug ?? 'renova',
    ...(owner ? { owner } : {}),
    ios: { ...baseIos, ...(iosBundleId ? { bundleIdentifier: iosBundleId } : {}), infoPlist },
    android: { ...baseAndroid, package: androidPackage, permissions, blockedPermissions: blocked },
    plugins,
    extra: {
      ...baseExtra,
      appEnv,
      apiUrl,
      releaseConfigGaps: gaps,
      ...(projectId ? { eas: { ...((baseExtra.eas as object) ?? {}), projectId } } : {}),
    },
  } as ExpoConfig;
}

export default ({ config }: ConfigContext): ExpoConfig => buildConfig(config, process.env);
