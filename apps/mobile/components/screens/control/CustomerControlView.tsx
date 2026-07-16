/** Контроль — приёмка, замечания, качество */
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { UnifiedAcceptanceList } from '@/components/renova/UnifiedAcceptanceList';
import { computePendingAcceptanceCount } from '@/lib/domain/acceptancePending';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { api, ProjectIssue, WorkAcceptance } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { screenLayout } from '@/constants/screenLayout';
import { issueSeverityLabel, issueStatusLabel } from '@/constants/labels';
import { useNavFromHere } from '@/lib/navigation';

export function CustomerControlView() {
  const pathname = usePathname();
  const nav = useNavFromHere();
  const { user, activeProject, readOnly } = useRenova();
  const [issues, setIssues] = useState<ProjectIssue[]>([]);
  const [acceptances, setAcceptances] = useState<WorkAcceptance[]>([]);

  const reload = useCallback(() => {
    if (user && activeProject) {
      api.listIssues(user.id, activeProject.id).then(setIssues).catch(() => setIssues([]));
      api.listWorkAcceptances(user.id, activeProject.id).then(setAcceptances).catch(() => setAcceptances([]));
    }
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  if (!activeProject || !user) return <ProjectEmptyState role="customer" />;

  const pendingCount = computePendingAcceptanceCount(activeProject.stages, acceptances);
  const rework = activeProject.stages.filter((s) => s.status === 'rework');
  const openIssues = issues.filter((i) => i.status !== 'closed');

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <ReadOnlyBanner />
      <View style={s.summary}>
        <View style={s.cell}><Text style={s.n}>{pendingCount}</Text><Text style={s.l}>Приёмка</Text></View>
        <View style={s.cell}><Text style={s.n}>{openIssues.length || rework.length}</Text><Text style={s.l}>Замечания</Text></View>
        <View style={s.cell}><Text style={s.n}>{openIssues.filter(i => i.severity === 'critical' || i.severity === 'high').length}</Text><Text style={s.l}>Критичные</Text></View>
      </View>

      <Text style={s.section}>Ожидают приёмки</Text>
      <UnifiedAcceptanceList
        stages={activeProject.stages}
        acceptances={acceptances}
        returnTo={pathname}
      />

      <Text style={s.section}>Замечания</Text>
      {!openIssues.length && <Text style={s.empty}>Нет открытых замечаний</Text>}
      {openIssues.slice(0, 5).map((iss) => (
        <Pressable
          key={iss.id}
          style={s.row}
          onPress={() => { if (iss.stage_id) nav.stage(iss.stage_id); }}
          disabled={!iss.stage_id}
        >
          <Text style={s.title}>{iss.title}</Text>
          <Text style={s.meta}>{issueSeverityLabel(iss.severity)} · {issueStatusLabel(iss.status)}{iss.due_at ? ` · до ${iss.due_at.slice(0, 10)}` : ''}{iss.stage_id ? ' · → этап' : ''}</Text>
          {!readOnly && iss.status !== 'closed' && (
            <PrimaryButton title="Закрыть" compact variant="outline" onPress={() => api.closeIssue(user!.id, activeProject!.id, iss.id).then(reload)} />
          )}
        </Pressable>
      ))}

      {rework.length > 0 && <>
        <Text style={s.section}>Доработка</Text>
        {rework.map((st) => (
          <Pressable key={st.id} style={s.row} onPress={() => nav.stage(st.id)}>
            <Text style={s.title}>{st.name}</Text>
            <Text style={s.meta}>Доработка</Text>
          </Pressable>
        ))}
      </>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  summary: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  cell: { ...card, flex: 1, alignItems: 'center', marginBottom: 0 },
  n: { fontSize: 22, fontWeight: '800' }, l: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  section: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginVertical: 8 },
  row: { ...card, paddingVertical: 12 },
  title: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 12 },
});
