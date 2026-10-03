import type { ConfigContext, ExpoConfig } from 'expo/config';

export type AppEnv = 'development' | 'staging' | 'production';
type Env = Record<string, string | undefined>;

export const PLACEHOLDER_ANDROID_PACKAGE: string;
export const PLACEHOLDER_API_HOST: string;
export function resolveAppEnv(env: Env): AppEnv;
export function resolveApiUrl(env: Env, appEnv: AppEnv): string;
export function isPlaceholder(value: string | undefined): boolean;
export function releaseGaps(resolved: {
  apiUrl: string;
  androidPackage: string;
  projectId?: string;
  owner?: string;
}): string[];
export function buildConfig(base: Partial<ExpoConfig>, env: Env): ExpoConfig;
declare const _default: (ctx: ConfigContext) => ExpoConfig;
export default _default;
