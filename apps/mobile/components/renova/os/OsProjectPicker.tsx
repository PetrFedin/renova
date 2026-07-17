/** Выбор проекта в шапке — группы «В работе» / «Завершённые» + портфель */
import { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
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
import type { OsRole } from '@/constants/osSections';

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

function ProjectPickerRow({
  p,
  active,
  loading,
  busy,
  pendingById,
  onSelect,
  bucket = 'active',
  canManage = false,
  lifecycle,
}: {
  p: ProjectSummary;
  active: boolean;
  loading: boolean;
  busy: boolean;
  pendingById: Record<string, number>;
  onSelect: (id: string) => void;
  bucket?: ProjectBucket;
  canManage?: boolean;
  lifecycle?: {
    onArchive?: () => void;
    onTrash?: () => void;
    onRestore?: () => void;
    onUnarchive?: () => void;
    onPurge?: () => void;
  };
}) {
  return (
    <View style={[s.itemWrap, active && s.itemOn]}>
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
      {canManage ? (
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
  const { user, projects, activeProject, loadProject, showPaywall } = useRenova();
  const canManage = user?.role === 'customer';
  const [open, setOpen] = useState(false);
  const { bucket, setBucket, items: bucketItems, archivedCount, trashedCount, reload: reloadBuckets } = useProjectBuckets(open ? user?.id : undefined, canManage);
  const { lifecycleHandlers, emptyTrash } = useProjectLifecycleActions(reloadBuckets);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingById, setPendingById] = useState<Record<string, number>>({});

  const portfolio = useMemo(() => summarizePortfolio(projects, pendingById), [projects, pendingById]);
  const displayProjects = bucket === 'active' ? projects : bucketItems;
  const { inProgress, completed } = useMemo(
    () => partitionPortfolioProjects(displayProjects, pendingById),
    [displayProjects, pendingById],
  );
  const showPortfolioRow = projects.length >= 2 && bucket === 'active';
  const isPortfolioScreen = pathname.includes('/portfolio');

  useEffect(() => {
    if (!open || !user) return;
    const closing = displayProjects.filter((p) => p.progress_percent >= 100);
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
  }, [open, user?.id, displayProjects]);

  if (!activeProject || projects.length === 0) return null;

  async function select(id: string) {
    if (bucket !== 'active') return;
    if (busyId) return;
    if (id === activeProject?.id) {
      setOpen(false);
      return;
    }
    setBusyId(id);
    try {
      await loadProject(id);
      setOpen(false);
    } catch (e: any) {
      if (e?.code === 'subscription_required' || e?.status === 402) showPaywall();
      else Alert.alert('Ошибка', 'Не удалось переключить объект. Попробуйте ещё раз.');
    } finally {
      setBusyId(null);
    }
  }

  function openPortfolio() {
    setOpen(false);
    pushScreen('/portfolio');
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
        {projects.length > 1 ? (
          <View style={s.countBadge}>
            <Text style={s.countBadgeT}>{projects.length}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.backdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setOpen(false)} accessibilityLabel="Закрыть" />
          <View style={[s.menuWrap, { paddingTop: topInset + 56, maxHeight: '85%' }]}>
            <ScrollView style={s.menuScroll} contentContainerStyle={s.menuScrollIn} bounces={false}>
              <View style={s.menu}>
                <Text style={s.menuHead}>Объекты</Text>
                <ProjectBucketToolbar bucket={bucket} onChange={setBucket} archivedCount={archivedCount} trashedCount={trashedCount} canManage={canManage} />
                {bucket === 'trashed' && canManage && trashedCount > 0 ? (
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
                        active={!isPortfolioScreen && p.id === activeProject.id}
                        loading={busyId === p.id}
                        busy={!!busyId}
                        pendingById={pendingById}
                        onSelect={select}
                        bucket={bucket}
                        canManage={canManage}
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
                        active={!isPortfolioScreen && p.id === activeProject.id}
                        loading={busyId === p.id}
                        busy={!!busyId}
                        pendingById={pendingById}
                        onSelect={select}
                        bucket={bucket}
                        canManage={canManage}
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
                  style={s.item}
                  onPress={() => {
                    setOpen(false);
                    pushTab('object', 'profile');
                  }}
                >
                  <Ionicons name="create-outline" size={18} color={RenovaTheme.colors.textMuted} />
                  <Text style={s.itemT}>Редактировать профиль</Text>
                </Pressable>
                {bucket === 'active' ? (
                  <Pressable
                    style={s.item}
                    onPress={() => {
                      setOpen(false);
                      pushScreen('/wizard/type');
                    }}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={RenovaTheme.colors.accent} />
                    <Text style={[s.itemT, { color: RenovaTheme.colors.accent }]}>Новый проект</Text>
                  </Pressable>
                ) : null}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  countBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: RenovaTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  countBadgeT: { color: RenovaTheme.colors.surface, fontSize: 8, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  menuWrap: { position: 'absolute', top: 0, right: 12, left: 12, alignItems: 'flex-end' },
  menuScroll: { maxWidth: 340, width: '100%' },
  menuScrollIn: { alignItems: 'flex-end' },
  menu: {
    minWidth: 280,
    maxWidth: 340,
    width: '100%',
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: RenovaTheme.radius.md,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  menuHead: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sectionHead: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.textSubtle,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  sectionHeadGap: { marginTop: 4, borderTopWidth: 1, borderTopColor: RenovaTheme.colors.borderLight },
  itemWrap: { paddingBottom: 4, position: 'relative', minHeight: 72 },
  item: { position: 'relative' as const,
 flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  portfolioItem: { backgroundColor: RenovaTheme.colors.borderLight },
  itemOn: { backgroundColor: RenovaTheme.colors.infoBg },
  itemBody: { flex: 1, minWidth: 0, paddingRight: 8 },
  itemWithActions: { paddingBottom: 36 },
  itemStatus: { alignSelf: 'flex-start', marginTop: 2 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  itemTitleOn: { color: RenovaTheme.colors.accent },
  itemMeta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2, lineHeight: 16 },
  itemProgress: { fontSize: 11, color: RenovaTheme.colors.textSubtle, marginTop: 4 },
  itemT: { flex: 1, fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  divider: { height: 1, backgroundColor: RenovaTheme.colors.border, marginVertical: 6, marginHorizontal: 12 },
  emptyTrashBtn: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    borderRadius: RenovaTheme.radius.sm,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.dangerBorder,
    alignItems: 'center',
  },
  emptyTrashT: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.danger },
  emptyBucket: { fontSize: 12, color: RenovaTheme.colors.textMuted, paddingHorizontal: 16, paddingVertical: 8 },
});
