/** Полный экран единого inbox — чат · оплаты · согласования · приёмка · этапы · offline */
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { BackHeader } from '@/components/renova/BackHeader';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { useRenova } from '@/lib/context/RenovaContext';
import { useInboxTasks } from '@/lib/useChatUnread';
import { filterInboxForHero, type InboxItem } from '@/lib/domain/buildInboxItems';
import { resolveInboxNavigation } from '@/lib/domain/inboxNavigation';
import { navigateApproval } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { flushOfflineOutbox } from '@/lib/offline';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { reportCatch } from '@/lib/reportError';

function inboxSubtitle(badge: number, chatUnread: number): string {
  const chat = Math.max(0, chatUnread || 0);
  const tasks = Math.max(0, badge - chat);
  if (chat > 0 && tasks > 0) {
    return `${chat} непрочитанных · ${tasks} ${tasks === 1 ? 'задача' : tasks < 5 ? 'задачи' : 'задач'}`;
  }
  if (chat > 0) {
    return chat === 1 ? '1 непрочитанное' : `${chat} непрочитанных`;
  }
  if (badge <= 0) return 'Все задачи проекта';
  return `${badge} ${badge === 1 ? 'задача' : badge < 5 ? 'задачи' : 'задач'}`;
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

function InboxIntegrityBanner({
  hasConfirmedSnapshot,
  issueCount,
  onRetry,
}: {
  hasConfirmedSnapshot: boolean;
  issueCount: number;
  onRetry: () => void;
}) {
  return (
    <View style={s.integrityBanner} accessibilityRole="alert">
      <Text style={s.integrityTitle}>Не все данные входящих обновились</Text>
      <Text style={s.integrityText}>
        {hasConfirmedSnapshot
          ? 'Показаны последние подтверждённые задачи. Новые изменения появятся после восстановления источников.'
          : 'Актуальность задач пока не подтверждена. Пустой список не означает, что активных задач нет.'}
      </Text>
      {issueCount > 0 ? (
        <Text style={s.integrityMeta}>Недоступных источников: {issueCount}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={s.retryButton}
      >
        <Text style={s.retryText}>Повторить загрузку</Text>
      </Pressable>
    </View>
  );
}

export function UnifiedInboxScreen({ role, returnTo, heroKind: heroKindProp }: { role: OsRole; returnTo?: string; heroKind?: string }) {
  const { user, activeProject, readOnly } = useRenova();
  const { items, health, badge, chatUnread, reload } = useInboxTasks(role);

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
      await flushOfflineOutbox().catch(reportCatch('components.screens.UnifiedInboxScreen.1'));
      await reload().catch(reportCatch('components.screens.UnifiedInboxScreen.2'));
      return;
    }

    const target = resolveInboxNavigation(it);
    if (target.kind === 'approval') {
      navigateApproval(target.approval, role, returnTo);
      return;
    }
    // W111: role → /control и short aliases через resolvePushLink SoT
    pushOsNav(target.href, returnTo, role);
  };

  const subtitle = readOnly
    ? 'Только просмотр — действия недоступны'
    : health.status === 'degraded'
      ? 'Часть источников временно недоступна'
      : health.status === 'idle'
        ? 'Обновляем актуальные задачи…'
        : inboxSubtitle(badge, chatUnread);

  return (
    <>
      <BackHeader
        title="Входящие"
        subtitle={subtitle}
        returnTo={returnTo}
      />
      <ReadOnlyBanner />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <OfflineSyncStatus />
        {health.status === 'degraded' ? (
          <InboxIntegrityBanner
            hasConfirmedSnapshot={health.hasConfirmedSnapshot}
            issueCount={health.issues.length}
            onRetry={() => { reload().catch(reportCatch('components.screens.UnifiedInboxScreen.retry')); }}
          />
        ) : null}
        {!visible.length && health.status === 'idle' ? (
          <Text style={s.loadingState}>Проверяем актуальные задачи…</Text>
        ) : null}
        {!visible.length && health.status === 'complete' ? (
          <EmptyActionState
            title="Нет активных задач"
            hint="Всё под контролем — можно открыть сообщения или документы."
            actionLabel="Сообщения"
            actionVariant="primary"
            onAction={() => pushOsNav(tabsRoute(role, 'chat'), returnTo, role)}
          />
        ) : null}
        {visible.map((it) => (
          <InboxRow key={it.id} item={it} onPress={() => { open(it).catch(reportCatch('components.screens.UnifiedInboxScreen.3')); }} />
        ))}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  /** Clarity visual: list-row, не card-стек входящих */
  row: { ...listRowStyles.row, flexDirection: 'row', alignItems: 'center' },
  title: { ...screenTypography.listTitle },
  sub: { ...screenTypography.listMeta },
  arrow: { fontSize: 18, color: RenovaTheme.colors.textMuted, marginLeft: 8 },
  integrityBanner: {
    backgroundColor: RenovaTheme.colors.warningBg,
    borderColor: RenovaTheme.colors.warningBorder,
    borderWidth: 1,
    borderRadius: RenovaTheme.radius.lg,
    padding: RenovaTheme.spacing.md,
    marginBottom: RenovaTheme.spacing.md,
  },
  integrityTitle: {
    fontSize: RenovaTheme.fontSize.body,
    fontWeight: RenovaTheme.fontWeight.semibold,
    color: RenovaTheme.colors.warningText,
    marginBottom: RenovaTheme.spacing.xs,
  },
  integrityText: {
    fontSize: RenovaTheme.fontSize.bodySmall,
    color: RenovaTheme.colors.text,
    lineHeight: 18,
  },
  integrityMeta: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
    marginTop: RenovaTheme.spacing.xs,
  },
  retryButton: {
    alignSelf: 'flex-start',
    minHeight: RenovaTheme.minTouch,
    justifyContent: 'center',
    marginTop: RenovaTheme.spacing.sm,
    paddingHorizontal: RenovaTheme.spacing.md,
    borderRadius: RenovaTheme.radius.sm,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.warningBorder,
  },
  retryText: {
    color: RenovaTheme.colors.warningText,
    fontWeight: RenovaTheme.fontWeight.semibold,
    fontSize: RenovaTheme.fontSize.bodySmall,
  },
  loadingState: {
    ...screenTypography.empty,
    textAlign: 'center',
    marginTop: RenovaTheme.spacing.xl,
  },
});
