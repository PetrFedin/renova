/** Полный экран единого inbox — раздельные счётчики по категориям */
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { BackHeader } from '@/components/renova/BackHeader';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { useRenova } from '@/lib/context/RenovaContext';
import { useInboxTasks } from '@/lib/useChatUnread';
import { filterInboxForHero, type InboxItem } from '@/lib/domain/buildInboxItems';
import {
  formatInboxCountersSubtitle,
  inboxCounterSummaryRows,
  type InboxCounters,
} from '@/lib/domain/inboxCounters';
import { navigateApproval } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { flushOfflineOutbox } from '@/lib/offline';
import type { OsRole } from '@/constants/osSections';
import { reportCatch } from '@/lib/reportError';

function InboxRow({ item, onPress }: { item: InboxItem; onPress: () => void }) {
  return (
    <Pressable style={s.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{item.title}</Text>
        {item.sub ? <Text style={s.sub}>{item.sub}</Text> : null}
      </View>
      <Text style={s.arrow}>→</Text>
    </Pressable>
  );
}

function CounterSummary({ counters }: { counters: InboxCounters }) {
  const rows = inboxCounterSummaryRows(counters);
  if (!rows.length) return null;
  return (
    <View style={s.summary} accessibilityRole="summary">
      <Text style={s.summaryHead}>Сводка</Text>
      {rows.map((r) => (
        <View key={r.key} style={s.summaryRow}>
          <Text style={s.summaryLabel}>{r.label}</Text>
          <Text style={s.summaryCount}>{r.count}</Text>
        </View>
      ))}
    </View>
  );
}

export function UnifiedInboxScreen({ role, returnTo, heroKind: heroKindProp }: { role: OsRole; returnTo?: string; heroKind?: string }) {
  const { user, activeProject, readOnly } = useRenova();
  const { items, counters, reload } = useInboxTasks(role);

  if (!user || !activeProject) {
    return (
      <>
        <BackHeader title="Входящие" returnTo={returnTo} />
        <ProjectEmptyState role={role} />
      </>
    );
  }

  const visible = heroKindProp ? filterInboxForHero(items, heroKindProp) : items;

  const open = async (it: InboxItem) => {
    if (it.kind === 'offline') {
      await flushOfflineOutbox().catch(reportCatch('components.screens.UnifiedInboxScreen.1'));
      await reload().catch(reportCatch('components.screens.UnifiedInboxScreen.2'));
      return;
    }
    if (it.kind === 'approval') navigateApproval(it.approval, role, returnTo);
    else pushOsNav(it.href, returnTo, role);
  };

  return (
    <>
      <BackHeader
        title="Входящие"
        subtitle={readOnly ? 'Только просмотр — действия недоступны' : formatInboxCountersSubtitle(counters)}
        returnTo={returnTo}
      />
      <ReadOnlyBanner />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <OfflineSyncStatus />
        <CounterSummary counters={counters} />
        {!visible.length && (
          <Text style={s.empty}>Нет активных задач — всё под контролем</Text>
        )}
        {visible.map((it) => (
          <InboxRow key={it.id} item={it} onPress={() => { open(it).catch(reportCatch('components.screens.UnifiedInboxScreen.3')); }} />
        ))}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  summary: {
    ...card,
    marginBottom: 12,
    paddingVertical: 12,
  },
  summaryHead: {
    fontSize: 12,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  summaryLabel: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  summaryCount: { fontSize: 15, fontWeight: '800', color: RenovaTheme.colors.text },
  row: { ...card, flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingVertical: 12 },
  title: { fontWeight: '700', fontSize: 15 },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  arrow: { fontSize: 18, color: RenovaTheme.colors.textMuted, marginLeft: 8 },
  empty: { textAlign: 'center', color: RenovaTheme.colors.textMuted, marginTop: 24 },
});
