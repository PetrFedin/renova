import { Stack } from 'expo-router';

/** Стабильный объект: inline screenOptions на Stack → риск Maximum update depth */
const CONTRACTOR_STACK_OPTIONS = { headerShown: false } as const;

export default function ContractorLayout() {
  return (
    <Stack screenOptions={CONTRACTOR_STACK_OPTIONS}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="[tool]" />
    </Stack>
  );
}
