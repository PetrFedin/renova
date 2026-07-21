import { reportError } from '@/lib/reportError';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

import { RenovaTheme, card } from '@/constants/Theme';
import { flushOfflineOutbox, getOfflineOutboxStatus, subscribeOfflineFlush } from '@/lib/offline';
import { getQueue } from '@/lib/offlineQueue';
import { useRenova } from '@/lib/context/RenovaContext';
import { reconcileChatAfterOfflineFlush } from '@/lib/chatSync';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
/** Статус канонической offline-очереди (тот же storage, что layout flush). */
export function OfflineSyncStatus({
  compact = false,
  pathIncludes,
  label,
}: {
  compact?: boolean;
  /** Если задано — считаем только jobs, чей path содержит одну из строк (W75 приёмка) */
  pathIncludes?: string[];
  label?: string;
}) {
  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const { user, activeProject } = useRenova();

  const refresh = useCallback(async () => {
    if (pathIncludes?.length) {
      let q: Awaited<ReturnType<typeof getQueue>> = [];
      try {
        q = await getQueue();
      } catch (e) {
        reportError('offline.getQueue', e);
        setLastMessage('Не удалось прочитать очередь офлайн');
        return;
      }
      const filtered = q.filter((j) => pathIncludes.some((s) => j.path.includes(s)));
      setPending(filtered.filter((j) => !j.blocked && !j.conflict).length);
      setBlocked(filtered.filter((j) => j.blocked).length);
      setConflicts(filtered.filter((j) => j.conflict).length);
      return;
    }
    let status: { total: number; pending: number; blocked: number; conflicts: number };
    try {
      status = await getOfflineOutboxStatus();
    } catch (e) {
      reportError('offline.outboxStatus', e);
      setLastMessage('Не удалось получить статус синхронизации');
      return;
    }
    setPending(status.pending);
    setBlocked(status.blocked);
    setConflicts(status.conflicts);
  }, [pathIncludes]);

  useFocusEffect(useCallback(() => {
    refresh().catch((e) => reportError('offline.refresh', e));
  }, [refresh]));
  useEffect(() => subscribeOfflineFlush(() => { void refresh(); }), [refresh]);

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await flushOfflineOutbox();
      if (result.conflicts > 0) {
        setLastMessage(`Отправлено: ${result.synced}, конфликтов: ${result.conflicts}`);
      } else if (result.failed) {
        setLastMessage(`Отправлено: ${result.synced}, с ошибкой: ${result.failed}`);
      } else {
        setLastMessage('Все доступные изменения отправлены');
      }
      await refresh();
      // Один reconciliation через orchestrator (не несколько reload)
      if (result.synced > 0) {
        await syncProjectSideEffects({ user, project: activeProject }).catch((e) => reportError('offline.sideEffects', e));
      } else if (user?.id) {
        await reconcileChatAfterOfflineFlush().catch((e) => reportError('offline.inboxSync', e));
      }
    } finally {
      setSyncing(false);
    }
  };

  if (compact && pending === 0 && blocked === 0 && conflicts === 0) return null;

  const scope = label ? `${label}: ` : '';
  const unsynced = pending + blocked + conflicts;
  const title = pending > 0
    ? `${scope}Не синхронизировано: ${pending} действий`
    : conflicts > 0
      ? `${scope}Не синхронизировано: ${conflicts} конфликтов`
      : blocked > 0
        ? `${scope}Не синхронизировано: ${blocked} заблокированы`
        : unsynced > 0
          ? `${scope}Не синхронизировано: ${unsynced}`
          : 'Офлайн-очередь пуста';

  const hint = lastMessage || (
    conflicts > 0
      ? 'Сервер отклонил изменения (409). Откройте экран конфликтов.'
      : blocked > 0
        ? 'Сервер отклонил часть изменений. Они больше не отправляются автоматически.'
        : 'Последние данные доступны из кэша. Изменения можно отправить вручную.'
  );

  const iconName = pending > 0 ? 'cloud-upload-outline' : (conflicts > 0 || blocked > 0) ? 'warning-outline' : 'cloud-done-outline';
  const iconColor = pending > 0 ? RenovaTheme.colors.warning : (conflicts > 0 || blocked > 0) ? RenovaTheme.colors.danger : RenovaTheme.colors.success;

  return (
    <View style={styles.card}>
      <View style={styles.main}>
        <View style={styles.iconWrap}>
          <Ionicons name={iconName} size={18} color={iconColor} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.hint}>{hint}</Text>
        </View>
      </View>
      {pending > 0 ? (
        <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={runSync} disabled={syncing}>
          {syncing ? <ActivityIndicator size="small" color={RenovaTheme.colors.primary} /> : <Text style={styles.buttonText}>Синхронизировать</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...card, gap: 10, marginBottom: 12 },
  main: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: RenovaTheme.colors.surfaceMuted },
  textWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '800', color: RenovaTheme.colors.text },
  hint: { marginTop: 2, fontSize: 12, lineHeight: 16, color: RenovaTheme.colors.textMuted },
  button: { alignSelf: 'flex-start', borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: RenovaTheme.colors.surface },
  pressed: { opacity: 0.85 },
  buttonText: { fontSize: 12, fontWeight: '800', color: RenovaTheme.colors.primary },
});
