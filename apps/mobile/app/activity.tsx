import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { ActivityFeed } from '@/components/renova/ActivityFeed';
import { DecisionHistoryPanel } from '@/components/renova/DecisionHistoryPanel';
import { FilterDropdown } from '@/components/renova/FilterDropdown';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RepairProcessTimeline } from '@/components/renova/RepairProcessTimeline';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, type ProjectDetail } from '@/lib/api';
import { pickPrimaryDemoProject } from '@/lib/pickPrimaryDemoProject';
import { RenovaTheme } from '@/constants/Theme';

export default function ActivityScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user, activeProject, projects, loadProject } = useRenova();
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [viewProject, setViewProject] = useState<ProjectDetail | null>(null);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );

  const defaultProjectId = useMemo(
    () => activeProject?.id ?? pickPrimaryDemoProject(projects)?.id ?? projects[0]?.id ?? null,
    [activeProject?.id, projects],
  );

  useEffect(() => {
    setSelectedProjectId((prev) => prev ?? defaultProjectId);
  }, [defaultProjectId]);

  const reloadActivityProject = useCallback(() => {
    if (!user || !selectedProjectId) {
      setViewProject(null);
      return;
    }
    if (activeProject?.id === selectedProjectId) {
      setViewProject(activeProject);
      return;
    }
    api.getProject(user.id, selectedProjectId)
      .then((p) => setViewProject(p))
      .catch(() => setViewProject(null));
  }, [user?.id, selectedProjectId, activeProject]);

  useEffect(() => {
    reloadActivityProject();
  }, [reloadActivityProject]);
  // W98: после golden-path — архив/timeline объект актуален
  useProjectDataReload(reloadActivityProject);

  const selectedName = useMemo(
    () => projects.find((p) => p.id === selectedProjectId)?.name ?? viewProject?.name,
    [projects, selectedProjectId, viewProject?.name],
  );

  const openDocuments = useCallback(async () => {
    if (!selectedProjectId) return;
    if (activeProject?.id !== selectedProjectId) {
      await loadProject(selectedProjectId).catch(() => {});
    }
    router.push({ pathname: '/documents', params: { returnTo: '/activity' } } as any);
  }, [selectedProjectId, activeProject?.id, loadProject]);

  if (!user) return null;
  if (!projects.length) {
    return (
      <>
        <BackHeader title="Архив ремонта" returnTo={returnTo} />
        <ProjectEmptyState role={role} hint="Создайте объект — архив событий привязан к проекту." />
      </>
    );
  }

  return (
    <>
      <BackHeader title="Архив ремонта" subtitle={selectedName || undefined} returnTo={returnTo} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {selectedProjectId ? (
          <FilterDropdown
            title="Объект"
            hint="Выберите объект — ниже показаны хронология и события только по нему"
            value={selectedProjectId}
            options={projectOptions}
            onChange={setSelectedProjectId}
            disabled={projectOptions.length <= 1}
          />
        ) : null}

        <View style={{ marginBottom: 12 }}>
          <PrimaryButton
            title="Все документы (PDF)"
            variant="outline"
            disabled={!selectedProjectId}
            onPress={() => { openDocuments().catch(() => {}); }}
          />
        </View>

        {viewProject ? (
          <>
            <RepairProcessTimeline stages={viewProject.stages || []} />
            <DecisionHistoryPanel
              userId={user.id}
              projectId={viewProject.id}
              returnTo={returnTo || '/activity'}
            />
            <ActivityFeed userId={user.id} projectId={viewProject.id} returnTo={returnTo || '/activity'} />
          </>
        ) : (
          <Text style={s.loading}>Загрузка архива…</Text>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  loading: {
    fontSize: 14,
    color: RenovaTheme.colors.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },
});
