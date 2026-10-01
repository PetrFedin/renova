import { Stack } from 'expo-router';
import { RoleGroupGuard } from '@/components/routing/RoleGroupGuard';

/** Стабильный объект: inline screenOptions на Stack → риск Maximum update depth */
const CONTRACTOR_STACK_OPTIONS = { headerShown: false } as const;

export default function ContractorLayout() {
  return (
    <RoleGroupGuard group="contractor">
    <Stack screenOptions={CONTRACTOR_STACK_OPTIONS}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="[tool]" />
    </Stack>
    </RoleGroupGuard>
  );
}
