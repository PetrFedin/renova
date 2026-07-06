/** Статусы work order, считающиеся «архивом» */
import type { WorkOrderStatus } from '@/lib/domain/workLifecycle';

export const WORK_ARCHIVE_STATUSES: WorkOrderStatus[] = ['cancelled', 'done', 'paid'];

export function isWorkArchived(status: string): boolean {
  return WORK_ARCHIVE_STATUSES.includes(status as WorkOrderStatus);
}
