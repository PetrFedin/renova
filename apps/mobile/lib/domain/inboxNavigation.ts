import type { ApprovalItem } from '@/lib/api';
import type { InboxItem } from './buildInboxItems';

export type InboxNavigationTarget =
  | { kind: 'approval'; approval: ApprovalItem }
  | { kind: 'href'; href: string };

/**
 * Inbox `kind` is intentionally open-ended for ordinary rows, so `kind ===
 * "approval"` cannot safely discriminate the union. Navigate by the actual
 * payload capability instead: approvals carry `approval`, all other rows carry
 * `href`.
 */
export function resolveInboxNavigation(item: InboxItem): InboxNavigationTarget {
  if ('approval' in item) {
    return { kind: 'approval', approval: item.approval };
  }
  return { kind: 'href', href: item.href };
}
