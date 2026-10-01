/** W67 #31: legacy deeplink → канон Приёмка (repair?tab=control).
 * UI-010: роль — только из сессии; пока она не загружена, не редиректим (иначе
 * исполнитель попадал во вкладки заказчика и видел «Принять / Вернуть»). */
import { Redirect, useLocalSearchParams } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useRenova } from '@/lib/context/RenovaContext';
import { effectiveAcceptanceRole } from '@/lib/domain/acceptanceActions';

export default function WorkAcceptanceRoute() {
  const { user, loading } = useRenova();
  const params = useLocalSearchParams();
  if (loading && !user) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  const role = effectiveAcceptanceRole(user?.role, 'customer');
  return (
    <Redirect
      href={{
        pathname: `/(${role})/(tabs)/repair`,
        params: { tab: 'control', ...params },
      }}
    />
  );
}
