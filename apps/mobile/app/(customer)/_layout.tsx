import { Stack } from 'expo-router';
import { RoleGroupGuard } from '@/components/routing/RoleGroupGuard';

/** Стабильный объект: inline screenOptions на Stack → риск Maximum update depth */
const CUSTOMER_STACK_OPTIONS = { headerShown: false } as const;

export default function CustomerLayout() {
  return (
    <RoleGroupGuard group="customer">
    <Stack screenOptions={CUSTOMER_STACK_OPTIONS}>
      <Stack.Screen name="(tabs)" />
    </Stack>
    </RoleGroupGuard>
  );
}
