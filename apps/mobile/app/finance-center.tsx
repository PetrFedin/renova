import { Redirect } from 'expo-router';
import { budgetTabRoute } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';

/** P3.4: finance-center → budget › payments (routeRegistry.redirectTo) */
export default function FinanceCenterRoute() {
  const { user } = useRenova();
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';
  const target = budgetTabRoute(role, 'payments');
  return <Redirect href={target as never} />;
}
