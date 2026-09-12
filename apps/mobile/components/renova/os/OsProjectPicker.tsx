/** Выбор проекта в шапке — группы «В работе» / «Завершённые» + портфель */
import { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator, Alert, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { useTopInset } from '@/lib/useTopInset';
import { useRenova } from '@/lib/context/RenovaContext';
import { useOsNavFromHere } from '@/lib/navigation';
import { api, type ProjectSummary } from '@/lib/api';
import { formatProjectPhaseLabel } from '@/lib/domain/formatProjectPhaseLabel';
import { summarizePortfolio } from '@/lib/domain/summarizePortfolio';
import { partitionPortfolioProjects } from '@/lib/domain/portfolioProjects';
import { ProjectBucketToolbar, type ProjectBucket } from '@/components/renova/ProjectBucketToolbar';
import { useProjectBuckets } from '@/lib/hooks/useProjectBuckets';
import { useProjectLifecycleActions } from '@/lib/hooks/useProjectLifecycleActions';
import { ProjectCardLifecycleIcons } from '@/components/renova/ProjectCardLifecycleIcons';
import { canManageProjectLifecycle } from '@/lib/domain/projectLifecycle';
import type { OsRole } from '@/constants/osSections';
import { filterOutJunkProjects } from '@/lib/junkProjects';

function projectMeta(p: ProjectSummary, pendingById: Record<string, number>): string {
  const type = p.property_type === 'house' ? 'Дом' : 'Квартира';
  const rooms = p.rooms_count ? `${p.rooms_count} комн.` : '';
  const pending = pendingById[p.id];
  const phase = formatProjectPhaseLabel(p, pending);
  const addr = p.address?.trim();
  return [type, rooms, phase, addr].filter(Boolean).join(' · ');
}

function portfolioDeltaLabel(summary: ReturnType<typeof summarizePortfolio>): string {
  if (summary.overspend > 0) {
    return `Перерасход ${formatRub(summary.overspend)} (${summary.variancePct > 0 ? '+' : ''}${summary.variancePct}%)`;
  }
  if (summary.savings > 0) {
    return `Экономия ${formatRub(summary.savings)} (${summary.variancePct}%)`;
  }
  return `По плану · ${summary.spendPct}% бюджета`;
}

function projectSwitchError(error: unknown): { code?: string; status?: number } {
  if (typeof error !== 'object' || error === null) return {};
  const value = error as Record<string, unknown>;
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    status: typeof value.status === 'number' ? value.status : undefined,
  };
}

function ProjectPickerRow({
  p,
  active,
  loading,
  busy,
  pendingById,
  onSelect,
  bucket = 'active',
  canManageProject = false,
  lifecycle,
}: {
  p: ProjectSummary;
  active: boolean;
  loading: boolean;
  busy: boolean;
  pendingById: Record<string, number>;
  onSelect: (id: string) => void;
  bucket?: ProjectBucket;
  canManageProject?: boolean;
  lifecycle?: {
    onArchive?: () => void;
    onTrash?: () => void;
    onRestore?: () => void;
    onUnarchive?: () => void;
    onPurge?: () => void;
  };
}) {
  return (
    <View style={[s.itemWrap, canManageProject && s.itemWithActions, active && s.itemOn]} pointerEvents="box-none">
      <Pressable
        style={s.item}
        onPress={() => onSelect(p.id)}
        disabled={busy || bucket !== 'active'}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <View style={s.itemBody}>
          <Text style={[s.itemTitle, active && s.itemTitleOn]} numberOfLines={1}>{p.name}</Text>
          <Text style={s.itemMeta} numberOfLines={2}>{projectMeta(p, pendingById)}</Text>
          <Text style={s.itemProgress} numberOfLines={1}>
            {formatRub(p.budget_spent)} из {formatRub(p.budget_planned)}
            {p.progress_percent < 100 ? ` · работы ${p.progress_percent}%` : ''}
          </Text>
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={RenovaTheme.colors.accent} />
        ) : active && bucket === 'active' ? (
          <Ionicons name="checkmark-circle" size={20} color={RenovaTheme.colors.accent} />
        ) : null}
      </Pressable>
      {canManageProject ? (
        <ProjectCardLifecycleIcons
          bucket={bucket}
          onArchive={lifecycle?.onArchive}
          onTrash={lifecycle?.onTrash}
          onRestore={lifecycle?.onRestore}
          onUnarchive={lifecycle?.onUnarchive}
          onPurge={lifecycle?.onPurge}
        />
      ) : null}
    </View>
  );
}

export function OsProjectPicker({ role }: { role: OsRole }) {
  const pathname = usePathname();
  const topInset = useTopInset();
  const { pushTab, pushScreen } = useOsNavFromHere(role);
  const { user, projects, activeProject, loadProject, showPaywall, readOnly } = useRenova();
  const canManageBuckets = user?.role === 'customer' && !readOnly;
  const [open, setOpen] = useState(false);
  const { bucket, setBucket, items: bucketItems, archivedCount, trashedCount, reload: reloadBuckets } = useProjectBuckets(open ? user?.id : undefined, canManageBuckets);
  const { lifecycleHandlers, emptyTrash } = useProjectLifecycleActions(reloadBuckets);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingById, setPendingById] = useState<Record<string, number>>({});

  const portfolio = useMemo(() => summarizePortfolio(projects, pendingById), [projects, pendingById]);
  // Investor honesty: E2E/Wizard Test не засоряют список объектов
  const activeProjects = useMemo(() => filterOutJunkProjects(projects), [projects]);
  const displayProjects = bucket === 'active' ? activeProjects : bucketItems;
  const { inProgress, completed } = useMemo(
    () => partitionPortfolioProjects(displayProjects, pendingById),
    [displayProjects, pendingById],
  );
  const showPortfolioRow = activeProjects.length >= 2 && bucket === 'active';
  const isPortfolioScreen = pathname.includes('/portfolio');

  useEffect(() => {
    if (!open || !user) return;
    const fromSummary: Record<string, number> = {};
    for (const p of displayProjects) {
      if (p.pending_payments != null) fromSummary[p.id] = p.pending_payments;
    }
    setPendingById((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(fromSummary);
      if (
        prevKeys.length === nextKeys.length
        && nextKeys.every((id) => prev[id] === fromSummary[id])
      ) {
        return prev;
      }
      return fromSummary;
    });

    const closing = displayProjects.filter((p) => p.progress_percent >= 100 && p.pending_payments == null);
    if (!closing.length) return;

    let cancelled = false;
    const t = setTimeout(() => {
      Promise.all(
        closing.map(async (p) => {
          try {
            const n = (await api.countPendingPayments(user.id, p.id)) || 0;
            return [p.id, n] as const;
          } catch {
            return [p.id, 0] as const;
          }
        }),
      ).then((rows) => {
        if (!cancelled) setPendingById((prev) => ({ ...prev, ...Object.fromEntries(rows) }));
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, user?.id, displayProjects]);

  if (!activeProject || activeProjects.length === 0) return null;
  const currentProjectId = activeProject.id;

  async function select(id: string) {
    if (bucket !== 'active') return;
    if (busyId) return;
    if (id === currentProjectId) {
      setOpen(false);
      return;
    }
    setBusyId(id);
    try {
      await loadProject(id);
      setOpen(false);
    } catch (error: unknown) {
      const { code, status } = projectSwitchError(error);
      if (code === 'subscription_required' || status === 402) showPaywall();
      else Alert.alert('Ошибка', 'Не удалось переключить объект. Попробуйте ещё раз.');
    } finally {
      setBusyId(null);
    }
  }

  function openPortfolio() {
    setOpen(false);
    setTimeout(() => pushScreen('/portfolio'), 0);
  }

  return (
    <>
      <Pressable
        style={s.btn}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Проект: ${activeProject.name}`}
        hitSlop={8}
      >
        <Ionicons name="business-outline" size={22} color={RenovaTheme.colors.text} />
        {activeProjects.length > 1 ? (
          <View style={s.countBadge}>
            <Text style={s.countBadgeT}>{activeProjects.length}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
          />
          <View style={[s.menuWrap, { paddingTop: topInset + 56 }]} pointerEvents="box-none">
            <ScrollView
              style={s.menuScroll}
              contentContainerStyle={s.menuScrollIn}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={Platform.OS === 'web'}
              nestedScrollEnabled
            >
              <View style={s.menu}>
                <Text style={s.menuHead}>Объекты</Text>
                <ProjectBucketToolbar bucket={bucket} onChange={setBucket} archivedCount={archivedCount} trashedCount={trashedCount} canManage={canManageBuckets} />
                {bucket === 'trashed' && canManageBuckets && trashedCount > 0 ? (
                  <Pressable style={s.emptyTrashBtn} onPress={emptyTrash}>
                    <Text style={s.emptyTrashT}>Очистить корзину</Text>
                  </Pressable>
                ) : null}

                {showPortfolioRow ? (
                  <>
                    <Pressable
                      style={[s.item, s.portfolioItem, isPortfolioScreen && s.itemOn]}
                      onPress={openPortfolio}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isPortfolioScreen }}
                    >
                      <Ionicons
                        name="albums-outline"
                        size={18}
                        color={isPortfolioScreen ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted}
                      />
                      <View style={s.itemBody}>
                        <Text style={[s.itemTitle, isPortfolioScreen && s.itemTitleOn]} numberOfLines={1}>
                          Все проекты ({portfolio.count})
                        </Text>
                        <Text style={s.itemMeta} numberOfLines={1}>
                          План {formatRub(portfolio.totalPlan)} · факт {formatRub(portfolio.totalSpent)}
                        </Text>
                        <Text style={s.itemProgress} numberOfLines={1}>
                          {portfolioDeltaLabel(portfolio)} · можно выбрать объекты
                        </Text>
                      </View>
                      {isPortfolioScreen ? (
                        <Ionicons name="checkmark-circle" size={20} color={RenovaTheme.colors.accent} />
                      ) : null}
                    </Pressable>
                    <View style={s.divider} />
                  </>
                ) : null}

                {inProgress.length ? (
                  <>
                    <Text style={s.sectionHead}>В работе</Text>
                    {inProgress.map((p) => (
                      <ProjectPickerRow
                        key={p.id}
                        p={p}
                        active={!isPortfolioScreen && p.id === currentProjectId}
                        loading={busyId === p.id}
                        busy={!!busyId}
                        pendingById={pendingById}
                        onSelect={select}
                        bucket={bucket}
                        canManageProject={canManageProjectLifecycle(p, user?.role, readOnly)}
                        lifecycle={lifecycleHandlers(p.id)}
                      />
                    ))}
                  </>
                ) : null}

                {completed.length ? (
                  <>
                    <Text style={[s.sectionHead, inProgress.length ? s.sectionHeadGap : null]}>Завершённые</Text>
                    {completed.map((p) => (
                      <ProjectPickerRow
                        key={p.id}
                        p={p}
                        active={!isPortfolioScreen && p.id === currentProjectId}
                        loading={busyId === p.id}
                        busy={!!busyId}
                        pendingById={pendingById}
                        onSelect={select}
                        bucket={bucket}
                        canManageProject={canManageProjectLifecycle(p, user?.role, readOnly)}
                        lifecycle={lifecycleHandlers(p.id)}
                      />
                    ))}
                  </>
                ) : null}

                {!inProgress.length && !completed.length ? (
                  <Text style={s.emptyBucket}>
                    {bucket === 'active' ? 'Нет проектов' : bucket === 'archived' ? 'Архив пуст' : 'Корзина пуста'}
                  </Text>
                ) : null}

                <View style={s.divider} />
                <Pressable
                  style={s.createRow}
                  onPress={() => {
                    setOpen(false);
                    setTimeout(() => pushTab('/projects'), 0);
                  }}
                  accessibilityRole="button"
                >
                  <Ionicons name="add-circle-outline" size={20} color={RenovaTheme.colors.accent} />
                  <Text style={s.createText}>Новый объект</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  countBadge: {
    position: 'absolute', right: 1, top: 1, minWidth: 17, height: 17, borderRadius: 8.5,
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RenovaTheme.colors.accent,
    borderWidth: 2, borderColor: RenovaTheme.colors.background,
  },
  countBadgeT: { fontSize: 9, fontWeight: '900', color: RenovaTheme.colors.textInverse },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  menuWrap: { alignItems: 'flex-end', paddingHorizontal: 12, maxHeight: '100%' },
  menuScroll: { width: 330, maxWidth: '92%', maxHeight: '82%' },
  menuScrollIn: { paddingBottom: 20 },
  menu: {
    backgroundColor: RenovaTheme.colors.surface, borderRadius: RenovaTheme.radius.lg, padding: 12,
    borderWidth: 1, borderColor: RenovaTheme.colors.border,
    ...RenovaTheme.shadow.card,
  },
  menuHead: { ...screenTypography.title, fontSize: 16, marginBottom: 8 },
  sectionHead: { ...screenTypography.caption, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4, marginTop: 2 },
  sectionHeadGap: { marginTop: 12 },
  itemWrap: { borderRadius: RenovaTheme.radius.md, marginBottom: 3 },
  itemWithActions: { paddingRight: 76 },
  item: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: RenovaTheme.radius.md },
  itemOn: { backgroundColor: RenovaTheme.colors.accentSoft },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { ...screenTypography.body, fontWeight: '700', color: RenovaTheme.colors.text },
  itemTitleOn: { color: RenovaTheme.colors.accent },
  itemMeta: { ...screenTypography.caption, color: RenovaTheme.colors.textMuted, marginTop: 1 },
  itemProgress: { ...screenTypography.caption, color: RenovaTheme.colors.textSecondary, marginTop: 2, fontWeight: '600' },
  portfolioItem: { borderWidth: 1, borderColor: RenovaTheme.colors.border, marginBottom: 3 },
  divider: { height: 1, backgroundColor: RenovaTheme.colors.border, marginVertical: 8 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  createText: { ...screenTypography.body, fontWeight: '700', color: RenovaTheme.colors.accent },
  emptyBucket: { ...screenTypography.caption, color: RenovaTheme.colors.textMuted, paddingHorizontal: 10, paddingVertical: 16 },
  emptyTrashBtn: { alignSelf: 'flex-start', marginHorizontal: 10, marginBottom: 6, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8, backgroundColor: RenovaTheme.colors.dangerSoft },
  emptyTrashT: { ...screenTypography.caption, color: RenovaTheme.colors.danger, fontWeight: '800' },
});
