/** Полный экран единого inbox — чат · оплаты · согласования · приёмка · этапы · offline */
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { BackHeader } from '@/components/renova/BackHeader';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { useRenova } from '@/lib/context/RenovaContext';
import { useInboxTasks } from '@/lib/useChatUnread';
import { filterInboxForHero, type InboxItem } from '@/lib/domain/buildInboxItems';
import { navigateApproval } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { flushOfflineOutbox } from '@/lib/offline';
import type { OsRole } from '@/constants/osSections';

function badgeLabel(badge: number, chatUnread: number): string {
  if (chatUnread > 0 && badge === chatUnread) {
    return chatUnread === 1 ? 'непрочитанное' : 'непрочитанных';
  }
  if (chatUnread > 0) {
    return badge === 1 ? 'дело требует внимания' : 'дел требуют внимания';
  }
  return badge === 1 ? 'задача' : badge < 5 ? 'задачи' : 'задач';
}

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

export function UnifiedInboxScreen({ role, returnTo, heroKind: heroKindProp }: { role: OsRole; returnTo?: string; heroKind?: string }) {
  const { user, activeProject, readOnly } = useRenova();
  const { items, badge, chatUnread, reload } = useInboxTasks(role);

  if (!user || !activeProject) {
    return (
      <>
        <BackHeader title="Входящие" returnTo={returnTo} />
        <ProjectEmptyState role={role} />
      </>
    );
  }

  /** Из меню — все строки; с главной — без дубля hero CTA */
  const visible = heroKindProp ? filterInboxForHero(items, heroKindProp) : items;

  const open = async (it: InboxItem) => {
    // W78: offline-строка → flush той же очереди, что OfflineSyncStatus
    if (it.kind === 'offline') {
      await flushOfflineOutbox().catch(() => {});
      await reload().catch(() => {});
      return;
    }
    if (it.kind === 'approval') navigateApproval(it.approval, role, returnTo);
    else pushOsNav(it.href, returnTo);
  };

  return (
    <>
      <BackHeader
        title="Входящие"
        subtitle={readOnly ? 'Только просмотр — действия недоступны' : badge > 0 ? `${badge} ${badgeLabel(badge, chatUnread)}` : 'Все задачи проекта'}
        returnTo={returnTo}
      />
      <ReadOnlyBanner />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <OfflineSyncStatus />
        {!visible.length && (
          <Text style={s.empty}>Нет активных задач — всё под контролем</Text>
        )}
        {visible.map((it) => (
          <InboxRow key={it.id} item={it} onPress={() => { open(it).catch(() => {}); }} />
        ))}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  row: { ...card, flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingVertical: 12 },
  title: { fontWeight: '700', fontSize: 15 },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  arrow: { fontSize: 18, color: RenovaTheme.colors.textMuted, marginLeft: 8 },
  empty: { textAlign: 'center', color: RenovaTheme.colors.textMuted, marginTop: 24 },
});
