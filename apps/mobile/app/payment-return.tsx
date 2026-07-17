import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';

/** Deep link renova://payment-return?projectId=&paymentId= после ЮKassa redirect. */
export default function PaymentReturnScreen() {
  const { projectId, paymentId } = useLocalSearchParams<{ projectId?: string; paymentId?: string }>();
  const { user, loadProject, refreshProjects } = useRenova();
  const [note, setNote] = useState('Проверяем статус оплаты…');

  useEffect(() => {
    if (!user?.id || !projectId || !paymentId) {
      Alert.alert('Оплата', 'Неверная ссылка возврата', [{ text: 'OK', onPress: () => router.replace('/(customer)/(tabs)/budget') }]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const items = await api.listPayments(user.id, projectId);
        const pay = items.find((p) => p.id === paymentId);
        await refreshProjects();
        await loadProject(projectId).catch(() => {});
        if (cancelled) return;
        if (pay?.status === 'confirmed') {
          setNote('Оплата подтверждена');
          Alert.alert('Готово', 'Оплата через ЮKassa зафиксирована.', [
            { text: 'В бюджет', onPress: () => router.replace('/(customer)/(tabs)/budget') },
          ]);
        } else {
          setNote('Ожидаем подтверждение от ЮKassa…');
          Alert.alert(
            'Оплата',
            'Если оплата прошла, статус обновится через несколько секунд. Проверьте раздел «Бюджет».',
            [{ text: 'В бюджет', onPress: () => router.replace('/(customer)/(tabs)/budget') }],
          );
        }
      } catch {
        if (!cancelled) router.replace('/(customer)/(tabs)/budget');
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, projectId, paymentId, loadProject, refreshProjects]);

  return (
    <View style={s.wrap}>
      <ActivityIndicator size="large" color={RenovaTheme.colors.primary} />
      <Text style={s.text}>{note}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, backgroundColor: RenovaTheme.colors.background, padding: 24 },
  text: { fontSize: 15, color: RenovaTheme.colors.textMuted, textAlign: 'center' },
});
