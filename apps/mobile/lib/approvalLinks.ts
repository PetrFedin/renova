/** Единые deep links для согласований → источник (комната / материал / смета / план) */
import type { ApprovalItem } from '@/lib/api';
import { objectTabHref, objectTabRoute, repairTabHref, type OsRole } from '@/constants/osSections';

export type ApprovalLink = { pathname: string; params?: Record<string, string> };

const APPROVALS_STACK = '/approvals';

/** Тип-specific проверки — до общего room_id, иначе material уходит в /room */
export function resolveApprovalHref(
  item: ApprovalItem,
  role: OsRole,
  detailReturnTo: string = APPROVALS_STACK,
): ApprovalLink | null {
  const rt = detailReturnTo;
  if (item.type === 'material') {
    return { pathname: '/material/[id]', params: { id: item.id, returnTo: rt } };
  }
  if (item.type === 'change_order') {
    const route = objectTabRoute(role, 'estimate');
    return {
      pathname: route.pathname,
      params: { ...route.params, estimateLayer: 'changes', returnTo: rt },
    };
  }
  if (item.type === 'room_change') {
    return item.room_id
      ? { pathname: '/room/[id]', params: { id: item.room_id, returnTo: rt } }
      : { pathname: objectTabHref(role, 'rooms'), params: { returnTo: rt } };
  }
  if (item.type === 'design') {
    return { pathname: objectTabHref(role, 'plan', 'design'), params: { returnTo: rt } };
  }
  if (item.type === 'waste') {
    return { pathname: repairTabHref(role, 'materials'), params: { returnTo: rt } };
  }
  if (item.stage_id) {
    return { pathname: '/stage/[id]', params: { id: item.stage_id, returnTo: rt } };
  }
  if (item.room_id) {
    return { pathname: '/room/[id]', params: { id: item.room_id, returnTo: rt } };
  }
  return null;
}

export { APPROVAL_TYPE_LABEL } from '@/constants/labels';

/** Подпись кнопки drill-down */
export function approvalSourceLabel(item: ApprovalItem): string {
  if (item.type === 'material') return 'Открыть материал →';
  if (item.type === 'change_order') return 'Открыть доп. работы →';
  if (item.type === 'room_change' && item.room_id) return 'Открыть комнату →';
  if (item.type === 'design') return 'Открыть дизайн →';
  if (item.stage_id) return 'Открыть этап →';
  if (item.room_id) return 'Открыть комнату →';
  return 'Открыть источник →';
}
