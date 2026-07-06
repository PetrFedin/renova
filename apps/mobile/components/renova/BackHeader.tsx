import { Pressable, View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { goBack, goHome } from '@/lib/navigation';
import { useRenova } from '@/lib/context/RenovaContext';
import { OsAppHeader } from '@/components/renova/os/OsAppHeader';
import { formatReturnToTrail } from '@/lib/breadcrumb';

type Props = { title: string; returnTo?: string | string[]; subtitle?: string };

function resolveReturnTo(returnTo?: string | string[]): string | undefined {
  if (Array.isArray(returnTo)) return returnTo[0];
  return returnTo;
}

function NavActions({ returnTo }: { returnTo?: string | string[] }) {
  const { user } = useRenova();
  return (
    <View style={s.actions}>
      <Pressable onPress={() => goBack(returnTo, user?.role)} style={s.btn} hitSlop={8} accessibilityLabel="Назад">
        <Ionicons name="chevron-back" size={24} color={RenovaTheme.colors.primary} />
      </Pressable>
      <Pressable onPress={() => goHome(user?.role)} style={s.btn} hitSlop={8} accessibilityLabel="На главную">
        <Ionicons name="home-outline" size={20} color={RenovaTheme.colors.textMuted} />
      </Pressable>
    </View>
  );
}

/** Шапка внутри экрана — navigation header отключён, safe area гарантирован */
export function BackHeader({ title, returnTo, subtitle }: Props) {
  const { user } = useRenova();
  const rt = resolveReturnTo(returnTo);
  const trail = formatReturnToTrail(rt, user?.role || 'customer');
  const mergedSubtitle = [trail, subtitle].filter(Boolean).join(' · ') || undefined;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <OsAppHeader title={title} subtitle={mergedSubtitle} left={<NavActions returnTo={returnTo} />} />
    </>
  );
}

const s = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  btn: { padding: 6, borderRadius: 6 },
});
