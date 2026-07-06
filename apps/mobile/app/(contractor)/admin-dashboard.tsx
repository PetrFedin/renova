import { View, Text, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { RenovaTheme } from '@/constants/Theme';

/** Native fallback — полный dashboard в admin-dashboard.web.tsx */
export default function AdminDashboardNative() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <BackHeader title="Панель администратора" />
      <View style={s.wrap}>
        <Text style={s.title}>Панель</Text>
        <Text style={s.sub}>Полная версия доступна в web-превью (desktop).</Text>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 24, backgroundColor: RenovaTheme.colors.background },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  sub: { color: RenovaTheme.colors.textMuted },
});
