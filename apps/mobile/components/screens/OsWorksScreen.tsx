/** Единый экран «Работы» — фильтры, карточки, SLA исполнителя */
import { useCallback, useMemo, useState, useEffect } from 'react';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { useNavFromHere } from '@/lib/navigation';
import { SearchFilter } from '@/components/renova/SearchFilter';
import { RepairProcessTimeline } from '@/components/renova/RepairProcessTimeline';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { WorkStageCard } from '@/components/renova/WorkStageCard';
import { RejectStageModal } from '@/components/renova/RejectStageModal';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ReworkSlaWidget } from '@/components/renova/ReworkSlaWidget';
import { TodayWidget } from '@/components/renova/TodayWidget';
import { CreateStageSheet } from '@/components/renova/CreateStageSheet';
import { CreateWorkSheet } from '@/components/renova/CreateWorkSheet';
import { StageDependenciesPanel } from '@/components/renova/StageDependenciesPanel';
import { WorkOrdersListPanel } from '@/components/renova/WorkOrdersListPanel';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import type { OsRole } from '@/constants/osSections';
import { screenLayout } from '@/constants/screenLayout';

const FILTERS = [
  { key: 'all', label: 'Активные' },
  { key: 'today', label: 'Сегодня' },
  { key: 'overdue', label: 'Просрочено' },
  { key: 'review', label: 'Приёмка' },
  { key: 'active', label: 'В работе' },
  { key: 'archive', label: 'Архив' },
  { key: 'rework', label: 'Доработка' },
  { key: 'material', label: 'Ждёт материал' },
];

export function OsWorksScreen({ role }: { role: OsRole }) {
  const nav = useNavFromHere();
  const { user, activeProject, rejectStage, loadProject, submitStage, readOnly } = useRenova();
  const [blockedMap, setBlockedMap] = useState<Record<string, { blocked: boolean; depends_on?: string; status_label?: string }>>({});
  const [query, setQuery] = useState('');
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (typeof filterParam === 'string' && FILTERS.some((f) => f.key === filterParam)) {
      setFilter(filterParam);
    }
  }, [filterParam]);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectName, setRejectName] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateWork, setShowCreateWork] = useState(false);

  const isContractor = role === 'contractor';
  const isCustomer = role === 'customer';

  const reloadBlocked = useCallback(async () => {
    if (!user || !activeProject) return;
    const entries = await Promise.all(
      (activeProject.stages || []).map(async (s) => {
        try {
          const b = await api.stageBlocked(user.id, activeProject.id, s.id);
          return [s.id, b] as const;
        } catch {
          return [s.id, { blocked: false }] as const;
        }
      }),
    );
    setBlockedMap(Object.fromEntries(entries));
  }, [user?.id, activeProject?.id, activeProject?.stages?.length]);

  useFocusEffect(useCallback(() => { reloadBlocked(); if (isContractor && user && activeProject) api.reworkSlaCheck(user.id, activeProject.id).catch(() => {}); }, [reloadBlocked, isContractor, user?.id, activeProject?.id]));

  const stages = useMemo(() => {
    if (!activeProject) return [];
    const today = new Date().toISOString().slice(0, 10);
    return [...activeProject.stages]
      .sort((a, b) => {
        if (a.needs_rework && !b.needs_rework) return -1;
        if (!a.needs_rework && b.needs_rework) return 1;
        return a.sort_order - b.sort_order;
      })
      .filter((s) => {
        if (filter === 'archive' && s.status !== 'done') return false;
        if (filter === 'all' && s.status === 'done') return false;
        if (filter === 'rework' && !s.needs_rework) return false;
        if (filter === 'overdue' && !(s.planned_end && s.planned_end < today && s.status !== 'done')) return false;
        if (filter === 'material' && !blockedMap[s.id]?.blocked) return false;
        if (filter === 'today' && !(s.planned_start === today || s.planned_end === today)) return false;
        if (!['all', 'archive', 'rework', 'overdue', 'today', 'material'].includes(filter) && s.status !== filter) return false;
        if (query && !s.name.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      });
  }, [activeProject, filter, query, blockedMap]);

  const toggleSel = (id: string) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulkReady = async () => {
    if (!user || !activeProject) return;
    for (const id of sel) await submitStage(id);
    await loadProject(activeProject.id);
    setSel(new Set());
  };

  if (!activeProject) {
    return <ProjectEmptyState role={role} />;
  }

  return (
    <>
      <ReadOnlyBanner />
      <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <RepairProcessTimeline stages={activeProject.stages || []} />
        {isContractor && user && (
          <>
            <ReworkSlaWidget stages={activeProject.stages} userId={user.id} projectId={activeProject.id} role="contractor" onExtended={() => loadProject(activeProject.id)} />
            <TodayWidget stages={activeProject.stages} role="contractor" />
          </>
        )}
        <SearchFilter query={query} onQuery={setQuery} filters={FILTERS} active={filter} onFilter={setFilter} />
        {user && (
          <StageDependenciesPanel userId={user.id} projectId={activeProject.id} role={role} />
        )}
        {user && (
          <WorkOrdersListPanel
            userId={user.id}
            projectId={activeProject.id}
            rooms={activeProject.rooms}
            role={role}
          />
        )}
        {isContractor && !readOnly && (
          <View style={s.createRow}>
            <PrimaryButton title="+ Этап" onPress={() => setShowCreate(true)} />
            <PrimaryButton title="+ Работа" variant="outline" onPress={() => setShowCreateWork(true)} />
          </View>
        )}
        {isContractor && sel.size > 0 && (
          <PrimaryButton title={`На приёмку (${sel.size})`} onPress={bulkReady} />
        )}
        {stages.map((s) => {
          const room = s.room_ids?.[0] ? activeProject.rooms?.find((r) => r.id === s.room_ids![0])?.name : undefined;
          const primary = s.status === 'review' && !readOnly && isCustomer ? 'Проверить' : undefined;
          return (
            <WorkStageCard
              key={s.id}
              stage={s as any}
              roomLabel={room}
              readOnly={readOnly}
              onOpen={() => nav.stage(s.id)}
              onLongPress={isContractor ? () => toggleSel(s.id) : undefined}
              primaryLabel={primary}
              blocked={blockedMap[s.id]?.blocked}
              blockedReason={blockedMap[s.id]?.depends_on || undefined}
              onPrimary={primary === 'Проверить' ? () => nav.stage(s.id) : undefined}
              selected={isContractor && sel.has(s.id)}
            />
          );
        })}
        {isContractor && <Text style={s.hint}>Долгое нажатие — выбрать для массовой сдачи</Text>}
        <RejectStageModal visible={!!rejectId} stageName={rejectName} onClose={() => setRejectId(null)} onConfirm={async (reason) => { if (rejectId) await rejectStage(rejectId, reason); setRejectId(null); await loadProject(activeProject.id); }} />
        {!stages.length && <Text style={s.empty}>Нет работ по фильтру</Text>}
      </ScrollView>
      {user && isContractor && (
        <CreateStageSheet
          visible={showCreate}
          project={activeProject}
          onClose={() => setShowCreate(false)}
          onCreate={async (body) => {
            await api.createStage(user.id, activeProject.id, body);
            await loadProject(activeProject.id);
          }}
        />
      )}
      {user && isContractor && (
        <CreateWorkSheet
          visible={showCreateWork}
          userId={user.id}
          projectId={activeProject.id}
          rooms={activeProject.rooms || []}
          onClose={() => setShowCreateWork(false)}
          onCreated={async () => {
            await loadProject(activeProject.id);
            setShowCreateWork(false);
          }}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: RenovaTheme.colors.textMuted },
  empty: { textAlign: 'center', color: RenovaTheme.colors.textMuted, marginTop: 24 },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 8, textAlign: 'center' },
  createRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
});
