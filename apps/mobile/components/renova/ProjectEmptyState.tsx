/** Пустое состояние — нет активного проекта; список с группами «В работе» / «Завершённые» */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { router, usePathname } from 'expo-router';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
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
import { pushOsNav } from '@/lib/pushOsNav';

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
  const { user, projects, loadProject, showPaywall, recoverSession, ensureActiveProject, projectResolving, readOnly, refreshProjects } = useRenova();
  const canManageBuckets = user?.role === 'customer' && !readOnly;
  const { bucket, setBucket, items: bucketItems, archivedCount, trashedCount, loading: bucketLoading, reload: reloadBuckets } = useProjectBuckets(user?.id, canManageBuckets);
  const { lifecycleHandlers, emptyTrash } = useProjectLifecycleActions(reloadBuckets);
  const [pendingById, setPendingById] = useState<Record<string, number>>({});

  const displayProjects = bucket === 'active' ? projects : bucketItems;
  const { inProgress, completed } = useMemo(
    () => partitionPortfolioProjects(displayProjects, pendingById),
    [displayProjects, pendingById],
  );

  useEffect(() => {
    if (autoPick && bucket === 'active' && projects.length) ensureActiveProject().catch(() => {});
  }, [autoPick, bucket, projects.length, ensureActiveProject]);

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
    if (bucket !== 'active') return;
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

      {showCreate && bucket === 'active' && (
        <PrimaryButton
          title="Создать объект"
          variant={projects.length ? 'outline' : 'primary'}
          onPress={() => pushOsNav('/wizard/type', pathname, role === 'contractor' ? 'contractor' : 'customer')}
        />
      )}
      {!projects.length && role === 'customer' ? (
        <View style={{ gap: 8 }}>
          <Text style={formMetaText.caption}>Или шаблон объекта (W69)</Text>
          {([
            ['apartment_2room', '2-комнатная'],
            ['studio', 'Студия'],
            ['house', 'Дом'],
          ] as const).map(([id, label]) => (
            <PrimaryButton
              key={id}
              title={`Шаблон: ${label}`}
              variant="outline"
              onPress={async () => {
                if (!user) return;
                try {
                  const p = await api.createProjectFromTemplate(user.id, { template_id: id, name: `${label}` });
                  await refreshProjects();
                  await loadProject((p as { id: string }).id);
                  await syncProjectSideEffects({ user, project: p as any });
                } catch {
                  /* noop */
                }
              }}
            />
          ))}
          <PrimaryButton title="Загрузить демо" variant="outline" onPress={() => recoverSession().catch(() => {})} />
        </View>
      ) : !projects.length ? (
        <PrimaryButton title="Загрузить демо" variant="outline" onPress={() => recoverSession().catch(() => {})} />
      ) : null}
      {!hideHomeButton && (
        <PrimaryButton
          title="На главную"
          variant="outline"
          onPress={() => router.replace(tabsRoute(role, 'index') as any)}
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
  wrapContent: { padding: 16, paddingBottom: 32, flexGrow: 1 },
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
  card: { position: 'relative' as const, paddingBottom: 44, ...card, marginBottom: 8 },
  cardPress: { gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontWeight: '700', fontSize: 15, color: RenovaTheme.colors.text },
  progressLine: { fontSize: 12, color: RenovaTheme.colors.textSubtle, marginTop: 2 },
});
