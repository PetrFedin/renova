/** Пустое состояние — нет активного проекта (вместо белого экрана return null) */
import { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router, usePathname } from 'expo-router';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { tabsRoute, type OsRole } from '@/constants/osSections';

type Props = {
  role: OsRole;
  title?: string;
  hint?: string;
  /** Показывать CTA создания объекта даже если есть другие проекты в списке */
  showCreate?: boolean;
  /** Скрыть «На главную» — когда экран уже главная */
  hideHomeButton?: boolean;
  /** Автоподхват сохранённого объекта — выключить на экране выбора после входа */
  autoPick?: boolean;
  /** После выбора карточки — кастомный обработчик (onboarding) */
  onSelectProject?: (projectId: string) => void | Promise<void>;
};

export function ProjectEmptyState({
  role,
  title = 'Сменить объект',
  hint = 'Выберите другой объект из списка или создайте новый.',
  showCreate = true,
  hideHomeButton = false,
  autoPick = true,
  onSelectProject,
}: Props) {
  const pathname = usePathname();
  const { projects, loadProject, showPaywall, recoverSession, ensureActiveProject, projectResolving } = useRenova();

  useEffect(() => {
    if (autoPick && projects.length) ensureActiveProject().catch(() => {});
  }, [autoPick, projects.length, ensureActiveProject]);

  if (projects.length > 0 && projectResolving && autoPick) {
    return (
      <View style={s.wrap}>
        <ActivityIndicator color={RenovaTheme.colors.primary} />
        <Text style={formMetaText.caption}>Загрузка объекта…</Text>
      </View>
    );
  }

  const pick = (id: string) => {
    if (onSelectProject) {
      onSelectProject(id).catch((e) => {
        if (e?.code === 'subscription_required' || e?.status === 402) showPaywall();
      });
      return;
    }
    loadProject(id).catch((e) => {
      if (e?.code === 'subscription_required' || e?.status === 402) showPaywall();
    });
  };

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      <Text style={formMetaText.caption}>{hint}</Text>
      {projects.map((p) => (
        <Pressable key={p.id} style={s.card} onPress={() => pick(p.id)}>
          <Text style={s.name}>{p.name}</Text>
          <Text style={formMetaText.caption}>{formatRub(p.budget_planned)} · {p.progress_percent}%</Text>
        </Pressable>
      ))}
      {!projects.length && (
        <Text style={formMetaText.caption}>Нет проектов. Создайте объект или загрузите демо-данные.</Text>
      )}
      {showCreate && (
        <PrimaryButton
          title="Создать объект"
          variant={projects.length ? 'outline' : 'primary'}
          onPress={() => router.push({ pathname: '/wizard/type', params: { returnTo: pathname } } as any)}
        />
      )}
      {!projects.length && (
        <PrimaryButton title="Загрузить демо" variant="outline" onPress={() => recoverSession().catch(() => {})} />
      )}
      {!hideHomeButton && (
        <PrimaryButton
          title="На главную"
          variant="outline"
          onPress={() => router.replace(tabsRoute(role, 'index') as any)}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background },
  title: { fontSize: 16, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 8 },
  card: { ...card, marginBottom: 8 },
  name: { fontWeight: '700', fontSize: 15 },
});
