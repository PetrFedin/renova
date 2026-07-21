/** Сборка API-клиента — доменные модули + единый export api */
import { authApi } from './auth';
import { projectsApi } from './projects';
import { roomsApi } from './rooms';
import { stagesApi } from './stages';
import { paymentsApi } from './payments';
import { estimateApi } from './estimate';
import { receiptsApi } from './receipts';
import { calendarApi } from './calendar';
import { chatsApi } from './chats';
import { notificationsApi } from './notifications';
import { osApi } from './os';
import { materialsApi } from './materials';
import { workOrdersApi } from './workOrders';
import { issuesApi } from './issues';
import { workAcceptancesApi } from './workAcceptances';
import { documentsApi } from './documents';
import { floorApi } from './floor';
import { marketApi } from './market';
import { designApi } from './design';
import { adminApi } from './admin';
import { scratchpadApi } from './scratchpad';
import { workScheduleApi } from './workSchedule';
import { miscApi } from './misc';
import { selectionsApi } from './selections';
import { tasksApi } from './tasks';

export const api = {
  ...authApi,
  ...projectsApi,
  ...roomsApi,
  ...stagesApi,
  ...paymentsApi,
  ...estimateApi,
  ...receiptsApi,
  ...calendarApi,
  ...chatsApi,
  ...notificationsApi,
  ...osApi,
  ...materialsApi,
  ...workOrdersApi,
  ...issuesApi,
  ...workAcceptancesApi,
  ...documentsApi,
  ...floorApi,
  ...marketApi,
  ...designApi,
  ...adminApi,
  ...scratchpadApi,
  ...workScheduleApi,
  ...miscApi,
  ...selectionsApi,
  ...tasksApi,
};
  ...selectionsApi,
};

export { ApiError, isRateLimitError, req, cachedGet, invalidateProjectsCache, API_BASE } from './client';
export * from './types';
export type { SelectionItem } from './selections';
export type {
  WorkSchedule,
  WorkScheduleStatus,
  WorkScheduleItem,
  WorkScheduleItemStatus,
} from './workSchedule';
