import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { RenovaTheme, card } from '@/constants/Theme';
import { flushOfflineOutbox, getOfflineOutboxStatus } from '@/lib/offline';

export function OfflineSyncStatus({ compact = false }: { compact?: boolean }) {
  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const status = await getOfflineOutboxStatus().catch(() => ({ total: 0, pending: 0, blocked: 0 }));
    setPending(status.pending);
    setBlocked(status.blocked);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await flushOfflineOutbox();
      setLastMessage(result.failed ? `Отправлено: ${result.synced}, с ошибкой: ${result.failed}` : 'Все доступные изменения отправлены');
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  if (compact && pending === 0 && blocked === 0) return null;

  const title = pending > 0
    ? `${pending} изменений ждут отправки`
    : blocked > 0
      ? `${blocked} изменений требуют проверки`
      : 'Офлайн-очередь пуста';

  const hint = lastMessage || (blocked > 0
    ? 'Некоторые изменения сервер отклонил. Они больше не отправляются автоматически.'
    : 'Последние данные доступны из кэша. Изменения можно отправить вручную.');

  const iconName = pending > 0 ? 'cloud-upload-outline' : blocked > 0 ? 'warning-outline' : 'cloud-done-outline';
  const iconColor = pending > 0 ? RenovaTheme.colors.warning : blocked > 0 ? RenovaTheme.colors.danger : RenovaTheme.colors.success;

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
