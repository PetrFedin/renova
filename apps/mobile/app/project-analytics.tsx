/** Legacy — единая аналитика только во вкладке «Бюджет → Аналитика» */
import { Redirect } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { budgetTabHref } from '@/constants/osSections';

export default function ProjectAnalyticsRedirect() {
  const { user } = useRenova();
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';
  return <Redirect href={budgetTabHref(role, 'analytics')} />;
}
