import { Stack } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';

export default function WizardLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: RenovaTheme.colors.background }, headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen name="type" options={{ title: 'Профиль объекта — 1/3' }} />
      <Stack.Screen name="rooms" options={{ title: 'Комнаты — 2/3' }} />
      <Stack.Screen name="confirm" options={{ title: 'Смета — 3/3' }} />
    </Stack>
  );
}
