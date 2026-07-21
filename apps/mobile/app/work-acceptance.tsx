/** W67 #31: legacy deeplink → канон Приёмка (repair?tab=control) */
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';

export default function WorkAcceptanceRoute() {
  const { user } = useRenova();
  const params = useLocalSearchParams();
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';
  return (
    <Redirect
      href={{
        pathname: `/(${role})/(tabs)/repair`,
        params: { tab: 'control', ...params },
      }}
    />
  );
}
