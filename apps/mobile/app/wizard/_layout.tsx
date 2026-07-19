import { Stack } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';

export default function WizardLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: RenovaTheme.colors.background }, headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen name="[step]" options={{ title: 'Новый объект' }} />
    </Stack>
  );
}
