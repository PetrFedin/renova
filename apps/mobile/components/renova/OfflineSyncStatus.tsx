import { reportError } from '@/lib/reportError';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

import { RenovaTheme, card } from '@/constants/Theme';
import { flushOfflineOutbox, getOfflineOutboxStatus, subscribeOfflineFlush } from '@/lib/offline';
import { getQueue } from '@/lib/offlineQueue';
import { useRenova } from '@/lib/context/RenovaContext';
import { reloadInboxSync } from '@/lib/inboxSyncStore';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { pushOsNav } from '@/lib/pushOsNav';

type PressState = { pressed: boolean };

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
  const [readError, setReadError] = useState<string | null>(null);
  const { user, activeProject } = useRenova();

  const refresh = useCallback(async () => {
    if (pathIncludes?.length) {
      try {
        const q = await getQueue();
        const filtered = q.filter((j) => pathIncludes.some((s) => j.path.includes(s)));
        setPending(filtered.filter((j) => !j.blocked && !j.conflict).length);
        setBlocked(filtered.filter((j) => j.blocked).length);
        setConflicts(filtered.filter((j) => j.conflict).length);
        setReadError(null);
      } catch (error) {
        reportError('offline.getQueue', error);
        setReadError('Не удалось прочитать локальную очередь. Данные не считаются синхронизированными.');
      }
      return;
    }

    try {
      const status = await getOfflineOutboxStatus();
      setPending(status.pending);
      setBlocked(status.blocked);
      setConflicts(status.conflicts);
      setReadError(null);
    } catch (error) {
      reportError('offline.outboxStatus', error);
      setReadError('Не удалось получить статус локальной очереди. Данные не считаются синхронизированными.');
    }
  }, [pathIncludes]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));
  useEffect(() => subscribeOfflineFlush(() => { void refresh(); }), [refresh]);

  const runSync = async () => {
    setSyncing(true);
    setLastMessage(null);
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
      // W112: после flush — inbox + home через канон bus (не только badge)
      if (result.synced > 0) {
        await syncProjectSideEffects({ user, project: activeProject }).catch((error) => reportError('offline.sideEffects', error));
      } else if (user?.id) {
        await reloadInboxSync({ userId: user.id, userRole: user.role }).catch((error) => reportError('offline.inboxSync', error));
      }
    } catch (error) {
      reportError('offline.sync', error);
      setReadError('Синхронизация остановлена: локальная очередь недоступна. Изменения не удалены.');
      setLastMessage('Синхронизация не выполнена');
    } finally {
      setSyncing(false);
    }
  };

  if (compact && pending === 0 && blocked === 0 && conflicts === 0 && !readError) return null;

  const scope = label ? `${label}: ` : '';
  const unsynced = pending + blocked + conflicts;
  const title = readError
    ? `${scope}Статус синхронизации недоступен`
    : pending > 0
      ? `${scope}Не синхронизировано: ${pending} действий`
      : conflicts > 0
        ? `${scope}Не синхронизировано: ${conflicts} конфликтов`
        : blocked > 0
          ? `${scope}Не синхронизировано: ${blocked} заблокированы`
          : unsynced > 0
            ? `${scope}Не синхронизировано: ${unsynced}`
            : 'Офлайн-очередь пуста';

  const hint = readError || lastMessage || (
    conflicts > 0
      ? 'Сервер отклонил изменения (409). Откройте экран конфликтов.'
      : blocked > 0
        ? 'Сервер отклонил часть изменений. Они больше не отправляются автоматически.'
        : 'Последние данные доступны из кэша. Изменения можно отправить вручную.'
  );

  const hasAttention = Boolean(readError) || conflicts > 0 || blocked > 0;
  const iconName = readError
    ? 'warning-outline'
    : pending > 0
      ? 'cloud-upload-outline'
      : hasAttention
        ? 'warning-outline'
        : 'cloud-done-outline';
  const iconColor = readError
    ? RenovaTheme.colors.danger
    : pending > 0
      ? RenovaTheme.colors.warning
      : hasAttention
        ? RenovaTheme.colors.danger
        : RenovaTheme.colors.success;

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

      {readError ? (
        <Pressable
          style={({ pressed }: PressState) => [styles.button, pressed && styles.pressed]}
          onPress={() => { void refresh(); }}
          disabled={syncing}
        >
          <Text style={styles.buttonText}>Повторить проверку</Text>
        </Pressable>
      ) : pending > 0 ? (
        <Pressable
          style={({ pressed }: PressState) => [styles.button, pressed && styles.pressed]}
          onPress={() => { void runSync(); }}
          disabled={syncing}
        >
          {syncing ? <ActivityIndicator size="small" color={RenovaTheme.colors.primary} /> : <Text style={styles.buttonText}>Синхронизировать</Text>}
        </Pressable>
      ) : null}

      {(readError || conflicts > 0 || blocked > 0) ? (
        <Pressable
          style={({ pressed }: PressState) => [styles.button, pressed && styles.pressed]}
          onPress={() => pushOsNav('/conflicts', undefined, (user?.role === 'contractor' ? 'contractor' : 'customer'))}
        >
          <Text style={styles.buttonText}>
            {readError ? 'Открыть очередь' : conflicts > 0 ? 'Открыть конфликты' : 'Открыть очередь'}
          </Text>
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
