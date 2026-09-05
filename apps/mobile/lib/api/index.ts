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
import { technicalSupervisionApi } from './technicalSupervision';

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
  ...technicalSupervisionApi,
};

export { ApiError, isRateLimitError, req, cachedGet, invalidateProjectsCache, API_BASE } from './client';
export * from './types';
export type { PaymentEvidence, PaymentEvidenceStatus, PaymentEvidenceUploadIntent } from './payments';
export type { SelectionItem } from './selections';
export type {
  TechnicalQualityIssueInput,
  TechnicalSupervisionAssignment,
  TechnicalSupervisionAssignmentInput,
  TechnicalSupervisionMutation,
  TechnicalSupervisionProviderType,
  TechnicalSupervisionStatus,
} from './technicalSupervision';
export type {
  WorkSchedule,
  WorkScheduleStatus,
  WorkScheduleItem,
  WorkScheduleItemStatus,
} from './workSchedule';
