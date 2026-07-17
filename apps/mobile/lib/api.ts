/** Публичная точка входа API — re-export из lib/api/ */
export { api, ApiError, isRateLimitError, invalidateProjectsCache } from './api/index';
export type * from './api/types';
