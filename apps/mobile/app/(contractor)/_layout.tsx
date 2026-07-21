import { Stack } from 'expo-router';

export default function ContractorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="[tool]" />
    </Stack>
  );
}
