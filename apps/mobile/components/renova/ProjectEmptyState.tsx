/** Пустое состояние — нет активного проекта; список с группами «В работе» / «Завершённые» */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { formMetaText } from '@/constants/formTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { StatusPill, type StatusTone } from '@/components/ui/StatusPill';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api, type ProjectSummary } from '@/lib/api';
import { formatProjectPhaseLabel } from '@/lib/domain/formatProjectPhaseLabel';
import { partitionPortfolioProjects } from '@/lib/domain/portfolioProjects';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { ProjectBucketToolbar, type ProjectBucket } from '@/components/renova/ProjectBucketToolbar';
import { useProjectBuckets } from '@/lib/hooks/useProjectBuckets';
import { useProjectLifecycleActions } from '@/lib/hooks/useProjectLifecycleActions';
import { ProjectCardLifecycleIcons } from '@/components/renova/ProjectCardLifecycleIcons';
import { canManageProjectLifecycle } from '@/lib/domain/projectLifecycle';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import { reportCatch, reportError } from '@/lib/reportError';

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

type EmptyActionFeedback = {
  tone: 'error' | 'warning';
  text: string;
};

function phaseTone(phase: string): StatusTone {
  if (phase === 'Завершён') return 'success';
  if (phase.startsWith('Закрытие')) return 'warning';
  return 'info';
}

function isSubscriptionRequired(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (
    ('code' in error && error.code === 'subscription_required') ||
    ('status' in error && error.status === 402)
  );
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
  bucket = 'active',
  canManageProject = false,
  onArchive,
  onTrash,
  onRestore,
  onUnarchive,
  onPurge,
}: {
  p: ProjectSummary;
  pendingById: Record<string, number>;
  onPress: () => void;
  bucket?: ProjectBucket;
  canManageProject?: boolean;
  onArchive?: () => void;
  onTrash?: () => void;
  onRestore?: () => void;
  onUnarchive?: () => void;
  onPurge?: () => void;
}) {
  const phase = formatProjectPhaseLabel(p, pendingById[p.id]);
  const progressLine =
    p.progress_percent < 100
      ? `${formatRub(p.budget_planned)} · работы ${p.progress_percent}%`
      : `${formatRub(p.budget_spent)} из ${formatRub(p.budget_planned)}`;

  return (
    <View style={s.card} pointerEvents="box-none">
      <Pressable style={s.cardPress} onPress={onPress} accessibilityRole="button">
        <View style={s.cardHead}>
          <Text style={s.name} numberOfLines={2}>{p.name}</Text>
          <StatusPill label={phase} tone={phaseTone(phase)} />
        </View>
        <Text style={formMetaText.caption} numberOfLines={1}>{projectCardMeta(p, pendingById)}</Text>
        <Text style={s.progressLine} numberOfLines={1}>{progressLine}</Text>
      </Pressable>
      {canManageProject ? (
        <ProjectCardLifecycleIcons
          bucket={bucket}
          onArchive={onArchive}
          onTrash={onTrash}
          onRestore={onRestore}
          onUnarchive={onUnarchive}
          onPurge={onPurge}
        />
      ) : null}
    </View>
  );
}

function ProjectSection({
  title,
  items,
  pendingById,
  onPick,
  withGap,
  bucket,
  role,
  readOnly,
  lifecycleHandlers,
}: {
  title: string;
  items: ProjectSummary[];
  pendingById: Record<string, number>;
  onPick: (id: string) => void;
  withGap?: boolean;
  bucket?: ProjectBucket;
  role?: import('@/lib/api').UserRole;
  readOnly?: boolean;
  lifecycleHandlers?: (id: string) => {
    onArchive?: () => void;
    onTrash?: () => void;
    onRestore?: () => void;
    onUnarchive?: () => void;
    onPurge?: () => void;
  };
}) {
  if (!items.length) return null;
  return (
    <View style={withGap ? s.sectionGap : undefined}>
      <Text style={s.sectionHead}>{title}</Text>
      {items.map((p) => (
        <ProjectPickCard
          key={p.id}
          p={p}
          pendingById={pendingById}
          onPress={() => onPick(p.id)}
          bucket={bucket}
          canManageProject={canManageProjectLifecycle(p, role, readOnly)}
          {...(lifecycleHandlers ? lifecycleHandlers(p.id) : {})}
        />
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
  const { user, projects, loadProject, showPaywall, ensureActiveProject, projectResolving, readOnly, refreshProjects } = useRenova();
  const canManageBuckets = user?.role === 'customer' && !readOnly;
  const { bucket, setBucket, items: bucketItems, archivedCount, trashedCount, loading: bucketLoading, reload: reloadBuckets } = useProjectBuckets(user?.id, canManageBuckets);
  const { lifecycleHandlers, emptyTrash } = useProjectLifecycleActions(reloadBuckets);
  const [pendingById, setPendingById] = useState<Record<string, number>>({});
  const [templateCreatingId, setTemplateCreatingId] = useState<string | null>(null);
  const [refreshingProjects, setRefreshingProjects] = useState(false);
  const [emptyActionFeedback, setEmptyActionFeedback] = useState<EmptyActionFeedback | null>(null);

  const displayProjects = bucket === 'active' ? projects : bucketItems;
  const { inProgress, completed } = useMemo(
    () => partitionPortfolioProjects(displayProjects, pendingById),
    [displayProjects, pendingById],
  );

  useEffect(() => {
    if (autoPick && bucket === 'active' && projects.length) ensureActiveProject().catch(reportCatch('components.renova.ProjectEmptyState.1'));
  }, [autoPick, bucket, projects.length, ensureActiveProject]);

  useEffect(() => {
    if (!user || !projects.length) {
      setPendingById({});
      return;
    }
    // Уже обогащённые в context — без лишних N+1 на экране «Выберите объект»
    const fromSummary: Record<string, number> = {};
    for (const p of projects) {
      if (p.pending_payments != null) fromSummary[p.id] = p.pending_payments;
    }
    setPendingById(fromSummary);

    const closing = projects.filter((p) => p.progress_percent >= 100 && p.pending_payments == null);
    if (!closing.length) return;

    let cancelled = false;
    const t = setTimeout(() => {
      Promise.all(
        closing.map(async (p) => {
          try {
            const n = (await api.countPendingPayments(user.id, p.id)) || 0;
            return [p.id, n] as const;
          } catch (error) {
            // Unknown payment state must remain «Закрытие»; a failed read is not zero pending payments.
            reportError('projectEmptyState.pendingPayments', error, { projectId: p.id });
            return null;
          }
        }),
      ).then((rows) => {
        if (cancelled) return;
        const confirmed: Record<string, number> = {};
        for (const row of rows) {
          if (row) confirmed[row[0]] = row[1];
        }
        if (Object.keys(confirmed).length) {
          setPendingById((prev) => ({ ...prev, ...confirmed }));
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
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
    if (bucket !== 'active') return;
    if (onSelectProject) {
      void Promise.resolve()
        .then(() => onSelectProject(id))
        .catch((error: unknown) => {
          if (isSubscriptionRequired(error)) showPaywall();
        });
      return;
    }
    loadProject(id).catch((error: unknown) => {
      if (isSubscriptionRequired(error)) showPaywall();
    });
  };

  const refreshEmptyProjects = async () => {
    if (!user || refreshingProjects) return;
    setRefreshingProjects(true);
    setEmptyActionFeedback(null);
    try {
      await refreshProjects();
    } catch (error) {
      reportError('projectEmptyState.refreshProjects', error, { userId: user.id, role });
      setEmptyActionFeedback({
        tone: 'error',
        text: 'Не удалось обновить проекты. Проверьте подключение и повторите.',
      });
    } finally {
      setRefreshingProjects(false);
    }
  };

  const createFromTemplate = async (templateId: string, name: string) => {
    if (!user || templateCreatingId || refreshingProjects) return;
    setTemplateCreatingId(templateId);
    setEmptyActionFeedback(null);

    const project = await api.createProjectFromTemplate(user.id, { template_id: templateId, name }).catch((error: unknown) => {
      reportError('projectEmptyState.templateCreate', error, { userId: user.id, templateId });
      if (isSubscriptionRequired(error)) {
        showPaywall();
      } else {
        setEmptyActionFeedback({
          tone: 'error',
          text: 'Не удалось создать объект. Проверьте подключение и повторите.',
        });
      }
      return null;
    });
    if (!project) {
      setTemplateCreatingId(null);
      return;
    }

    // The create mutation is already committed. Reconciliation failures below must
    // never be reported to the user as a failed creation or trigger a duplicate create.
    try {
      await refreshProjects();
    } catch (error) {
      reportError('projectEmptyState.templateRefreshProjects', error, { projectId: project.id, templateId });
    }

    let opened = true;
    try {
      await loadProject(project.id);
    } catch (error) {
      opened = false;
      reportError('projectEmptyState.templateLoadProject', error, { projectId: project.id, templateId });
    }

    try {
      await syncProjectSideEffects({ user, project });
    } catch (error) {
      reportError('projectEmptyState.templateSideEffects', error, { projectId: project.id, templateId });
    }

    if (!opened) {
      setEmptyActionFeedback({
        tone: 'warning',
        text: 'Объект создан, но не удалось открыть его автоматически. Обновите проекты и выберите объект.',
      });
    }
    setTemplateCreatingId(null);
  };

  return (
    <ScrollView
      style={s.wrap}
      contentContainerStyle={s.wrapContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={Platform.OS === 'web'}
      nestedScrollEnabled
    >
      {title ? <Text style={s.title}>{title}</Text> : null}
      {hint ? <Text style={formMetaText.caption}>{hint}</Text> : null}

      <ProjectBucketToolbar
        bucket={bucket}
        onChange={setBucket}
        archivedCount={archivedCount}
        trashedCount={trashedCount}
        canManage={canManageBuckets}
      />
      {bucketLoading ? <ActivityIndicator color={RenovaTheme.colors.primary} style={{ marginVertical: 12 }} /> : null}
      {bucket === 'trashed' && canManageBuckets && trashedCount > 0 ? (
        <PrimaryButton title="Очистить корзину" variant="outline" onPress={emptyTrash} />
      ) : null}

      {displayProjects.length > 0 ? (
        <>
          <ProjectSection title="В работе" items={inProgress} pendingById={pendingById} onPick={pick} bucket={bucket} role={user?.role} readOnly={readOnly} lifecycleHandlers={lifecycleHandlers} />
          <ProjectSection
            title="Завершённые"
            items={completed}
            pendingById={pendingById}
            onPick={pick}
            withGap={inProgress.length > 0}
            bucket={bucket}
            role={user?.role}
            readOnly={readOnly}
            lifecycleHandlers={lifecycleHandlers}
          />
        </>
      ) : (
        <Text style={formMetaText.caption}>{bucket === 'active' ? 'Нет проектов' : bucket === 'archived' ? 'Архив пуст' : 'Корзина пуста'}</Text>
      )}

      {emptyActionFeedback ? (
        <Text style={emptyActionFeedback.tone === 'error' ? s.actionError : s.actionWarning}>
          {emptyActionFeedback.text}
        </Text>
      ) : null}

      {showCreate && bucket === 'active' && role === 'customer' ? (
        <PrimaryButton
          title="Создать объект"
          variant={projects.length ? 'outline' : 'primary'}
          disabled={Boolean(templateCreatingId) || refreshingProjects}
          onPress={() => pushOsNav('/wizard/type', pathname, 'customer')}
        />
      ) : null}
      {!projects.length && role === 'customer' && bucket === 'active' ? (
        <View style={{ gap: 8 }}>
          <Text style={formMetaText.caption}>Быстро начать с шаблона</Text>
          {([
            ['apartment_2room', '2-комнатная'],
            ['studio', 'Студия'],
            ['house', 'Дом'],
          ] as const).map(([id, label]) => {
            const name = id === 'studio' ? 'Моя студия' : id === 'house' ? 'Мой дом' : 'Моя квартира';
            return (
              <PrimaryButton
                key={id}
                title={`Шаблон: ${label}`}
                variant="outline"
                loading={templateCreatingId === id}
                disabled={Boolean(templateCreatingId) || refreshingProjects}
                onPress={() => void createFromTemplate(id, name)}
              />
            );
          })}
        </View>
      ) : null}
      {!projects.length && role === 'contractor' && bucket === 'active' ? (
        <PrimaryButton
          title="Найти заявки"
          variant="outline"
          disabled={refreshingProjects}
          onPress={() => pushOsNav('/job-leads', pathname, 'contractor')}
        />
      ) : null}
      {!projects.length && bucket === 'active' ? (
        <PrimaryButton
          title="Обновить проекты"
          variant="outline"
          loading={refreshingProjects}
          disabled={Boolean(templateCreatingId)}
          onPress={() => void refreshEmptyProjects()}
        />
      ) : null}
      {!hideHomeButton && (
        <PrimaryButton
          title="На главную"
          variant="outline"
          onPress={() => replaceOsNav(tabsRoute(role, 'index'), undefined, role)}
        />
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 0,
    backgroundColor: RenovaTheme.colors.background,
    ...(Platform.OS === 'web' ? { overflowY: 'auto' as const } : null),
  },
  wrapContent: { padding: 16, paddingBottom: 32, flexGrow: 1, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 8 },
  sectionHead: {
    ...screenTypography.section,
    marginBottom: 8,
    marginTop: 4,
  },
  sectionGap: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
  },
  card: { position: 'relative' as const, paddingBottom: 44, ...card, marginBottom: 8 },
  cardPress: { gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontWeight: '700', fontSize: 15, color: RenovaTheme.colors.text },
  progressLine: { fontSize: 12, color: RenovaTheme.colors.textSubtle, marginTop: 2 },
  actionError: { fontSize: 12, color: RenovaTheme.colors.danger, lineHeight: 17 },
  actionWarning: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17 },
});
