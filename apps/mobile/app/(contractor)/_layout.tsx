import { Stack } from 'expo-router';

export default function ContractorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="subscription" />
      <Stack.Screen name="articles-admin" />
      <Stack.Screen name="audit" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="team-qr" />
      <Stack.Screen name="admin-dashboard" />
    </Stack>
  );
}
