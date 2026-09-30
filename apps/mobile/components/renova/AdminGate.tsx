import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { BackHeader } from '@/components/renova/BackHeader';
import { useAdminAccess } from '@/lib/hooks/useAdminAccess';

/** Админский экран: пока доступ не подтверждён backend-ом — «Нет доступа», а не белый экран. */
export function AdminGate({ children }: { children: ReactNode }) {
  const access = useAdminAccess();
  if (access === 'granted') return <>{children}</>;
  return (
    <>
      <BackHeader title="Админ" />
      <View style={s.wrap}>
        {access === 'unknown' ? (
          <ActivityIndicator />
        ) : (
          <>
            <Text style={s.title}>Нет доступа</Text>
            <Text style={s.sub}>Этот раздел доступен только администраторам.</Text>
          </>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  sub: { fontSize: 14, color: '#64748b', textAlign: 'center' },
});
