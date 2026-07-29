/** Offline queue recovery: conflicts, blocked and deferred mutations. */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { OfflineDiffViewer } from '@/components/renova/OfflineDiffViewer';
import { FieldMergePicker } from '@/components/renova/FieldMergePicker';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { dedupeQueue } from '@/lib/smartMerge';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import {
  getQueue,
  removeJob,
  retryJob,
  writeQueue,
  type OfflineJob,
} from '@/lib/offlineQueue';
import { flushOfflineOutbox, subscribeOfflineFlush } from '@/lib/offline';
import { RenovaTheme } from '@/constants/Theme';
import { offlineJobLabel, offlineJobPreview } from '@/lib/offlineJobLabel';
import { reportCatch } from '@/lib/reportError';

function jobStatus(job: OfflineJob, now = Date.now()): string {
  if (job.conflict) return 'Конфликт — требуется решение';
  if (job.blocked) return 'Остановлено после ошибок';
  if ((job.nextAttemptAt ?? 0) > now) {
    return `Следующая попытка: ${new Date(job.nextAttemptAt!).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }
  return 'Готово к синхронизации';
}

export default function ConflictsScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [jobs, setJobs] = useState<OfflineJob[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    setJobs(await getQueue());
  }, []);

  useFocusEffect(useCallback(() => { reload().catch(reportCatch('app._stack.conflicts.1')); }, [reload]));
  useEffect(() => subscribeOfflineFlush(() => { void reload(); }), [reload]);

  const summary = useMemo(() => {
    const conflicts = jobs.filter((job) => job.conflict && !job.blocked).length;
    const blocked = jobs.filter((job) => job.blocked).length;
    const pending = jobs.length - conflicts - blocked;
    return { conflicts, blocked, pending };
  }, [jobs]);

  const retryNow = useCallback(async (jobId: string) => {
    setBusyId(jobId);
    try {
      await retryJob(jobId);
      await flushOfflineOutbox();
      await reload();
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const syncReady = useCallback(async () => {
    setSyncing(true);
    try {
      await flushOfflineOutbox();
      await reload();
    } finally {
      setSyncing(false);
    }
  }, [reload]);

  return (
    <>
      <BackHeader
        title="Очередь синхронизации"
        returnTo={returnTo}
        subtitle={`${summary.pending} ожидают · ${summary.conflicts} конфликтов · ${summary.blocked} остановлено`}
      />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={s.hint}>
          Изменения сохранены на устройстве. Временные ошибки повторяются с паузой; конфликтные и остановленные операции требуют решения.
        </Text>
        {jobs.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyT}>Очередь пуста</Text>
            <Text style={s.emptySub}>Все изменения синхронизированы с сервером.</Text>
          </View>
        )}
        {jobs.map((job) => {
          const busy = busyId === job.id;
          return (
            <View key={job.id} style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.path}>{offlineJobLabel(job)}</Text>
                <Text style={[s.status, (job.conflict || job.blocked) && s.statusAttention]}>
                  {jobStatus(job)}
                </Text>
              </View>
              <Text style={s.preview}>{offlineJobPreview(job)}</Text>
              <Text style={s.meta}>
                {new Date(job.ts).toLocaleString('ru-RU')} · попыток: {job.attempts ?? 0}
              </Text>
              {job.lastError ? <Text style={s.error}>{job.lastError.slice(0, 240)}</Text> : null}

              {job.conflict ? (
                <>
                  <OfflineDiffViewer local={job.body} />
                  <FieldMergePicker
                    local={job.body}
                    onMerge={async (merged) => {
                      const body = typeof merged === 'string' ? merged : JSON.stringify(merged);
                      const next = jobs.map((item) => (item.id === job.id ? { ...item, body } : item));
                      await writeQueue(next);
                      await retryNow(job.id);
                    }}
                  />
                </>
              ) : null}

              <View style={s.actions}>
                <PrimaryButton
                  title="Повторить сейчас"
                  variant="outline"
                  onPress={() => { void retryNow(job.id); }}
                  loading={busy}
                  disabled={Boolean(busyId || syncing)}
                  fullWidth
                />
                <PrimaryButton
                  title="Удалить без синхронизации"
                  variant="dangerOutline"
                  disabled={Boolean(busyId || syncing)}
                  onPress={() => {
                    showActionConfirm({
                      title: 'Удалить из очереди?',
                      message: 'Локальное изменение будет безвозвратно удалено и не попадёт на сервер.',
                      primaryLabel: 'Удалить',
                      primaryDestructive: true,
                      onPrimary: () => { void removeJob(job.id).then(reload); },
                      secondaryLabel: 'Отмена',
                      onSecondary: () => undefined,
                    });
                  }}
                  fullWidth
                />
              </View>
            </View>
          );
        })}
        {jobs.length > 0 && (
          <>
            <PrimaryButton
              title="Убрать точные дубли"
              variant="outline"
              disabled={Boolean(busyId || syncing)}
              onPress={async () => {
                const deduped = dedupeQueue(jobs);
                await writeQueue(deduped);
                await reload();
              }}
              fullWidth
            />
            <View style={{ height: 8 }} />
            <PrimaryButton
              title="Синхронизировать готовые"
              onPress={() => { void syncReady(); }}
              loading={syncing}
              disabled={Boolean(busyId || syncing)}
              fullWidth
            />
          </>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  hint: { color: RenovaTheme.colors.textMuted, marginBottom: 12, lineHeight: 18, fontSize: 13 },
  empty: { backgroundColor: RenovaTheme.colors.surface, padding: 24, borderRadius: 12, alignItems: 'center' },
  emptyT: { fontWeight: '700', fontSize: 16 },
  emptySub: { color: RenovaTheme.colors.textMuted, marginTop: 6, textAlign: 'center' },
  card: { backgroundColor: RenovaTheme.colors.surface, padding: 12, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  cardHeader: { gap: 4, marginBottom: 4 },
  path: { fontWeight: '700', fontSize: 13 },
  status: { fontSize: 11, color: RenovaTheme.colors.textMuted },
  statusAttention: { color: RenovaTheme.colors.danger },
  meta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginVertical: 4 },
  preview: { fontSize: 12, color: RenovaTheme.colors.text, marginBottom: 4 },
  error: { fontSize: 11, lineHeight: 16, color: RenovaTheme.colors.danger, marginBottom: 8 },
  actions: { gap: 8, marginTop: 10 },
});
