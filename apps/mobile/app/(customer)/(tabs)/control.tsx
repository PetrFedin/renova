import { Redirect } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';

/** P3.4c: customer → work-acceptance, contractor → quality-control */
export default function ControlTabRedirect() {
  const { user } = useRenova();
  const href = user?.role === 'contractor' ? '/quality-control' : '/work-acceptance';
  return <Redirect href={href} />;
}
