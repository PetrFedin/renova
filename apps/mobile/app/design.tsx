/** Legacy — дизайн встроен в «Объект → План» */
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { objectTabHref } from '@/constants/osSections';

export default function DesignRedirect() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const { user } = useRenova();
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';
  const sub = tab === 'schedule' ? 'schedule' : 'design';
  return <Redirect href={objectTabHref(role, 'plan', sub)} />;
}
