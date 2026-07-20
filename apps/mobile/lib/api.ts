/** Публичная точка входа API — re-export из lib/api/ */
export { api, ApiError, isRateLimitError, invalidateProjectsCache } from './api/index';
export type * from './api/types';
export type { SelectionItem } from './api/selections';
export type { WorkSchedule, WorkScheduleStatus } from './api/workSchedule';
