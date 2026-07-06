/** Ожидание активного объекта — вместо повторного «выберите объект» */
import type { ReactNode } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useProjectScope } from '@/lib/hooks/useProjectScope';
import type { OsRole } from '@/constants/osSections';

type Props = {
  role: OsRole;
  children: ReactNode;
  hint?: string;
};

export function ProjectScopeLoader({ role, children, hint }: Props) {
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
      <ProjectEmptyState
        role={role}
        title="Создайте первый объект"
        hint="Создайте объект — смета, этапы и учёт расходов появятся автоматически."
        hideHomeButton
      />
    );
  }

  if (scope.status === 'pick') {
    return (
      <ProjectEmptyState
        role={role}
        title="Сменить объект"
        hint={hint ?? 'Объект с главной недоступен. Выберите другой из списка или создайте новый.'}
        hideHomeButton
      />
    );
  }

  if (scope.status === 'no-user') return null;

  return <>{children}</>;
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: RenovaTheme.colors.background,
  },
  text: { marginTop: 12, fontSize: 14, color: RenovaTheme.colors.textMuted },
});
