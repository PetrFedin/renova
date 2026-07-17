/** Ожидание активного объекта — без лишних подсказок */
import type { ReactNode } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useProjectScope } from '@/lib/hooks/useProjectScope';
import type { OsRole } from '@/constants/osSections';

type Props = {
  role: OsRole;
  children: ReactNode;
};

export function ProjectScopeLoader({ role, children }: Props) {
  const scope = useProjectScope();

  if (scope.status === 'loading') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={RenovaTheme.colors.primary} />
        <Text style={s.text}>Загрузка объекта…</Text>
      </View>
    );
  }

  if (scope.status === 'empty') {
    return (
      <View style={s.fill}>
        <ProjectEmptyState role={role} title="Создайте первый объект" hideHomeButton />
      </View>
    );
  }

  if (scope.status === 'pick') {
    return (
      <View style={s.fill}>
        <ProjectEmptyState role={role} title="Сменить объект" hideHomeButton />
      </View>
    );
  }

  if (scope.status === 'no-user') return null;

  return <>{children}</>;
}

const s = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: RenovaTheme.colors.background,
  },
  text: { marginTop: 12, fontSize: 14, color: RenovaTheme.colors.textMuted },
});
