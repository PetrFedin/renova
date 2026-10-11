import { budgetTabRoute, tabsRoute, type OsRole, type OsTabRoute } from '../../constants/osSections';
import type { ResponsibilityItem } from '../api/types/os';

/**
 * The queue API is scoped already, but a deep link is only a navigation hint.
 * Destination screens must load the resource from their scoped APIs and keep
 * authorization at their existing canonical mutation endpoints.
 */
export function actionQueueDestination(
  item: ResponsibilityItem,
  role: OsRole,
): OsTabRoute | null {
  const id = item.resource_id?.trim();
  if (!id) return null;

  if (item.resource_type === 'payment'
    && (item.action === 'pay_invoice' || item.action === 'confirm_payment_received')) {
    // Never pass openPayment=1: that fallback can open a different pending payment.
    return budgetTabRoute(role, 'payments', { paymentId: id });
  }

  if (item.resource_type === 'issue'
    && (item.action === 'resolve_issue' || item.action === 'verify_remediation')) {
    return tabsRoute(role, 'repair', 'control', { issueId: id });
  }

  if (item.resource_type === 'acceptance' && item.action === 'decide_work_acceptance') {
    return tabsRoute(role, 'repair', 'control', { acceptanceId: id });
  }

  // Unknown resource/action pairs fail closed instead of opening an unrelated hub.
  return null;
}
