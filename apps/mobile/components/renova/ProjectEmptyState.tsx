/** Пустое состояние — нет активного проекта; список с группами «В работе» / «Завершённые» */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router, usePathname } from 'expo-router';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { StatusPill, type StatusTone } from '@/components/ui/StatusPill';
import { useRenova } from '@/lib/context/RenovaContext';
import { api, type ProjectSummary } from '@/lib/api';
import { formatProjectPhaseLabel } from '@/lib/domain/formatProjectPhaseLabel';
import { partitionPortfolioProjects } from '@/lib/domain/portfolioProjects';
import { tabsRoute, type OsRole } from '@/constants/osSections';

type Props = {
  role: OsRole;
  title?: string;
  /** Короткая подпись — только если реально нужна; по умолчанию не показываем */
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

function phaseTone(phase: string): StatusTone {
  if (phase === 'Завершён') return 'success';
  if (phase.startsWith('Закрытие')) return 'warning';
  return 'info';
}

function projectCardMeta(p: ProjectSummary, pendingById: Record<string, number>): string {
  const type = p.property_type === 'house' ? 'Дом' : 'Квартира';
  const rooms = p.rooms_count ? `${p.rooms_count} комн.` : '';
  const addr = p.address?.trim();
  return [type, rooms, addr].filter(Boolean).join(' · ');
}

function ProjectPickCard({
  p,
  pendingById,
  onPress,
}: {
  p: ProjectSummary;
  pendingById: Record<string, number>;
  onPress: () => void;
}) {
  const phase = formatProjectPhaseLabel(p, pendingById[p.id]);
  const progressLine =
    p.progress_percent < 100
      ? `${formatRub(p.budget_planned)} · работы ${p.progress_percent}%`
      : `${formatRub(p.budget_spent)} из ${formatRub(p.budget_planned)}`;

  return (
    <Pressable style={s.card} onPress={onPress} accessibilityRole="button">
      <View style={s.cardHead}>
        <Text style={s.name} numberOfLines={2}>{p.name}</Text>
        <StatusPill label={phase} tone={phaseTone(phase)} />
      </View>
      <Text style={formMetaText.caption} numberOfLines={1}>{projectCardMeta(p, pendingById)}</Text>
      <Text style={s.progressLine} numberOfLines={1}>{progressLine}</Text>
    </Pressable>
  );
}

function ProjectSection({
  title,
  items,
  pendingById,
  onPick,
  withGap,
}: {
  title: string;
  items: ProjectSummary[];
  pendingById: Record<string, number>;
  onPick: (id: string) => void;
  withGap?: boolean;
}) {
  if (!items.length) return null;
  return (
    <View style={withGap ? s.sectionGap : undefined}>
      <Text style={s.sectionHead}>{title}</Text>
      {items.map((p) => (
        <ProjectPickCard key={p.id} p={p} pendingById={pendingById} onPress={() => onPick(p.id)} />
      ))}
    </View>
  );
}

export function ProjectEmptyState({
  role,
  title,
  hint,
  showCreate = true,
  hideHomeButton = false,
  autoPick = true,
  onSelectProject,
}: Props) {
  const pathname = usePathname();
  const { user, projects, loadProject, showPaywall, recoverSession, ensureActiveProject, projectResolving } = useRenova();
  const [pendingById, setPendingById] = useState<Record<string, number>>({});

  const { inProgress, completed } = useMemo(
    () => partitionPortfolioProjects(projects, pendingById),
    [projects, pendingById],
  );

  useEffect(() => {
    if (autoPick && projects.length) ensureActiveProject().catch(() => {});
  }, [autoPick, projects.length, ensureActiveProject]);

  useEffect(() => {
    if (!user || !projects.length) {
      setPendingById({});
      return;
    }
    const closing = projects.filter((p) => p.progress_percent >= 100);
    if (!closing.length) {
      setPendingById({});
      return;
    }
    let cancelled = false;
    Promise.all(
      closing.map(async (p) => {
        if (p.pending_payments != null) return [p.id, p.pending_payments] as const;
        try {
          const n = (await api.countPendingPayments(user.id, p.id)) || 0;
          return [p.id, n] as const;
        } catch {
          return [p.id, 0] as const;
        }
      }),
    ).then((rows) => {
      if (!cancelled) setPendingById(Object.fromEntries(rows));
    });
    return () => { cancelled = true; };
  }, [user?.id, projects]);

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
      {title ? <Text style={s.title}>{title}</Text> : null}
      {hint ? <Text style={formMetaText.caption}>{hint}</Text> : null}

      {projects.length > 0 ? (
        <>
          <ProjectSection title="В работе" items={inProgress} pendingById={pendingById} onPick={pick} />
          <ProjectSection
            title="Завершённые"
            items={completed}
            pendingById={pendingById}
            onPick={pick}
            withGap={inProgress.length > 0}
          />
        </>
      ) : (
        <Text style={formMetaText.caption}>Нет проектов</Text>
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
  sectionHead: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.textSubtle,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  sectionGap: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
  },
  card: { ...card, marginBottom: 8, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontWeight: '700', fontSize: 15, color: RenovaTheme.colors.text },
  progressLine: { fontSize: 12, color: RenovaTheme.colors.textSubtle, marginTop: 2 },
});
