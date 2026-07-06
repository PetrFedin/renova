import { Stack } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';

export default function WizardLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: RenovaTheme.colors.background }, headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen name="type" options={{ title: 'Новый объект' }} />
      <Stack.Screen name="rooms" options={{ title: 'Комнаты' }} />
      <Stack.Screen name="confirm" options={{ title: 'Смета и бюджет' }} />
    </Stack>
  );
}
