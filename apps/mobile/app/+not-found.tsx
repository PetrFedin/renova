import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { goBack, goHome } from '@/lib/navigation';
import { useRenova } from '@/lib/context/RenovaContext';

export default function NotFoundScreen() {
  const { user } = useRenova();
  const role = user?.role ?? null;
  return (
    <>
      <Stack.Screen options={{ title: 'Не найдено', headerShown: true, headerBackVisible: false }} />
      <View style={styles.container}>
        <Text style={styles.title}>Такого экрана нет</Text>
        <Text style={styles.sub}>Проверьте ссылку или вернитесь на главную</Text>
        <View style={styles.actions}>
          <PrimaryButton title="← Назад" variant="outline" onPress={() => goBack(undefined, role)} />
          <PrimaryButton title="На главную" onPress={() => goHome(role)} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  sub: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 24 },
  actions: { width: '100%', maxWidth: 280, gap: 10 },
});
