import { resolveApprovalHref, approvalSourceLabel } from './approvalLinks';
import type { ApprovalItem } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';

const item: ApprovalItem = {
  id: 'm1',
  type: 'material',
  title: 'Плитка',
  status: 'pending',
  room_id: 'r1',
};

const link = resolveApprovalHref(item, 'customer');
if (!link || link.pathname !== '/material/[id]' || link.params?.id !== 'm1' || link.params?.returnTo !== '/approvals') {
  throw new Error('material with room_id must link to material detail');
}

const roomItem: ApprovalItem = { id: 'x', type: 'room_change', title: 'X', status: 'pending', room_id: 'r2' };
const roomLink = resolveApprovalHref(roomItem, 'customer');
if (!roomLink || roomLink.params?.id !== 'r2' || roomLink.params?.returnTo !== '/approvals') throw new Error('room link failed');

if (approvalSourceLabel(item) !== 'Открыть материал →') throw new Error('label failed');

console.log('approvalLinks.test OK');

const co: ApprovalItem = { id: 'co1', type: 'change_order', title: 'CO', status: 'pending' };
const coLink = resolveApprovalHref(co, 'customer');
if (!coLink || coLink.params?.estimateLayer !== 'changes' || coLink.params?.returnTo !== '/approvals') {
  throw new Error('change_order must deep-link to estimate changes layer');
}
if (approvalSourceLabel(co) !== 'Открыть доп. работы →') throw new Error('change_order label');
