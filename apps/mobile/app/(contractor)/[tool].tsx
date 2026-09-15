import type { ComponentType } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import AdminScreen from './_screens/admin';
import AdminDashboardScreen from './_screens/admin-dashboard';
import ArticlesAdmin from './_screens/articles-admin';
import AuditScreen from './_screens/audit';
import OutboxDeadLettersScreen from './_screens/outbox-dead-letters';
import ProviderReconciliationsScreen from './_screens/provider-reconciliations';
import SubscriptionRefundReviewsScreen from './_screens/subscription-refund-reviews';
import SubscriptionScreen from './_screens/subscription';
import TeamQrScreen from './_screens/team-qr';

const MAP: Record<string, ComponentType> = {
  admin: AdminScreen,
  'admin-dashboard': AdminDashboardScreen,
  'articles-admin': ArticlesAdmin,
  audit: AuditScreen,
  'outbox-dead-letters': OutboxDeadLettersScreen,
  'provider-reconciliations': ProviderReconciliationsScreen,
  'subscription-refund-reviews': SubscriptionRefundReviewsScreen,
  subscription: SubscriptionScreen,
  'team-qr': TeamQrScreen,
};

/** P3-W39: contractor tools → один catch-all */
export default function ContractorTool() {
  const { tool } = useLocalSearchParams<{ tool: string }>();
  const seg = Array.isArray(tool) ? tool[0] : tool;
  const Comp = seg ? MAP[seg] : undefined;
  if (!Comp) return <Redirect href="/(contractor)/(tabs)" />;
  return <Comp />;
}
