/** Полный экран единого inbox — чат · оплаты · согласования · приёмка · этапы */
import { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { BackHeader } from '@/components/renova/BackHeader';
import { useRenova } from '@/lib/context/RenovaContext';
import { useChatUnread, useInboxWsListener } from '@/lib/useChatUnread';
import { buildInboxItems, deriveInboxHeroKind, filterInboxForHero, type InboxItem } from '@/lib/domain/buildInboxItems';
import { navigateApproval } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import type { OsRole } from '@/constants/osSections';

function InboxRow({ item, role, onPress }: { item: InboxItem; role: OsRole; onPress: () => void }) {
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
  const { count: chatUnread } = useChatUnread(user?.id);
  const [items, setItems] = useState<InboxItem[]>([]);

  const reload = useCallback(async () => {
    if (!user || !activeProject) return;
    const list = await buildInboxItems({
      userId: user.id,
      projectId: activeProject.id,
      role,
      chatUnread,
      project: activeProject,
    });
    setItems(list);
  }, [user?.id, activeProject, role, chatUnread]);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));
  useInboxWsListener(useCallback(() => { reload().catch(() => {}); }, [reload]));

  if (!user || !activeProject) {
    return (
      <>
        <BackHeader title="Входящие" returnTo={returnTo} />
        <ProjectEmptyState role={role} hint="Выберите объект для просмотра задач." />
      </>
    );
  }

  const heroKind = heroKindProp || deriveInboxHeroKind(items);
  const visible = filterInboxForHero(items, heroKind);

  const open = (it: InboxItem) => {
    if (it.kind === 'approval') navigateApproval(it.approval, role, returnTo);
    else pushOsNav(it.href, returnTo);
  };

  return (
    <>
      <BackHeader
        title="Входящие"
        subtitle={readOnly ? 'Только просмотр — действия недоступны' : 'Все задачи проекта'}
        returnTo={returnTo}
      />
      <ReadOnlyBanner />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {!visible.length && (
          <Text style={s.empty}>Нет активных задач — всё под контролем</Text>
        )}
        {visible.map((it) => (
          <InboxRow key={it.id} item={it} role={role} onPress={() => open(it)} />
        ))}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  row: { ...card, flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingVertical: 12 },
  title: { fontWeight: '700', fontSize: 15 },
  sub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  arrow: { color: RenovaTheme.colors.primary, fontWeight: '700', fontSize: 16 },
  empty: { textAlign: 'center', color: RenovaTheme.colors.textMuted, marginTop: 32, fontSize: 15 },
});
