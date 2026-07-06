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
import { floorApi } from './floor';
import { marketApi } from './market';
import { designApi } from './design';
import { adminApi } from './admin';
import { scratchpadApi } from './scratchpad';
import { miscApi } from './misc';

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
  ...floorApi,
  ...marketApi,
  ...designApi,
  ...adminApi,
  ...scratchpadApi,
  ...miscApi,
};

export { ApiError, isRateLimitError, req, cachedGet, API_BASE } from './client';
export * from './types';
