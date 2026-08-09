/** Offline queue recovery: conflicts, blocked and deferred mutations. */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { OfflineDiffViewer } from '@/components/renova/OfflineDiffViewer';
import { FieldMergePicker } from '@/components/renova/FieldMergePicker';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import {
  dedupeExactJobs,
  getQueue,
  removeJob,
  retryJob,
  updateJobBody,
  type OfflineJob,
} from '@/lib/offlineQueue';
import { flushOfflineOutbox, subscribeOfflineFlush } from '@/lib/offline';
import { RenovaTheme } from '@/constants/Theme';
import { offlineJobLabel, offlineJobPreview } from '@/lib/offlineJobLabel';
import { reportError } from '@/lib/reportError';

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
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const next = await getQueue();
      setJobs(next);
      setLoadError(null);
    } catch (error) {
      reportError('offline.conflicts.readQueue', error);
      // Never render/edit a stale snapshot after storage integrity/read failure.
      setJobs([]);
      setLoadError('Не удалось прочитать локальную очередь. Данные не удалены — повторите чтение.');
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => subscribeOfflineFlush(() => { void reload(); }), [reload]);

  const summary = useMemo(() => {
    const conflicts = jobs.filter((job) => job.conflict && !job.blocked).length;
    const blocked = jobs.filter((job) => job.blocked).length;
    const pending = jobs.length - conflicts - blocked;
    return { conflicts, blocked, pending };
  }, [jobs]);

  const retryNow = useCallback(async (jobId: string) => {
    setBusyId(jobId);
    setActionError(null);
    try {
      await retryJob(jobId);
      await flushOfflineOutbox();
      await reload();
    } catch (error) {
      reportError('offline.conflicts.retry', error, { jobId });
      setActionError('Повторная синхронизация не выполнена. Изменение осталось в очереди.');
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const syncReady = useCallback(async () => {
    setSyncing(true);
    setActionError(null);
    try {
      await flushOfflineOutbox();
      await reload();
    } catch (error) {
      reportError('offline.conflicts.syncReady', error);
      setActionError('Синхронизация не выполнена. Локальные изменения сохранены.');
    } finally {
      setSyncing(false);
    }
  }, [reload]);

  const removeWithoutSync = useCallback(async (jobId: string) => {
    setBusyId(jobId);
    setActionError(null);
    try {
      await removeJob(jobId);
      await reload();
    } catch (error) {
      reportError('offline.conflicts.remove', error, { jobId });
      setActionError('Не удалось удалить изменение из локальной очереди.');
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const dedupeNow = useCallback(async () => {
    setSyncing(true);
    setActionError(null);
    try {
      await dedupeExactJobs();
      await reload();
    } catch (error) {
      reportError('offline.conflicts.dedupe', error);
      setActionError('Не удалось проверить дубли. Очередь не была перезаписана.');
    } finally {
      setSyncing(false);
    }
  }, [reload]);

  const subtitle = loadError
    ? 'статус очереди недоступен'
    : `${summary.pending} ожидают · ${summary.conflicts} конфликтов · ${summary.blocked} остановлено`;

  return (
    <>
      <BackHeader
        title="Очередь синхронизации"
        returnTo={returnTo}
        subtitle={subtitle}
      />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={s.hint}>
          Изменения сохранены на устройстве. Временные ошибки повторяются с паузой; конфликтные и остановленные операции требуют решения.
        </Text>

        {loadError ? (
          <View style={s.errorCard}>
            <Text style={s.errorTitle}>Очередь недоступна</Text>
            <Text style={s.errorBody}>{loadError}</Text>
            <PrimaryButton
              title="Повторить чтение"
              variant="outline"
              onPress={() => { void reload(); }}
              loading={loadingQueue}
              disabled={syncing || Boolean(busyId)}
              fullWidth
            />
          </View>
        ) : null}

        {actionError ? (
          <View style={s.actionError}>
            <Text style={s.errorBody}>{actionError}</Text>
          </View>
        ) : null}

        {!loadError && jobs.length === 0 && !loadingQueue && (
          <View style={s.empty}>
            <Text style={s.emptyT}>Очередь пуста</Text>
            <Text style={s.emptySub}>Все изменения синхронизированы с сервером.</Text>
          </View>
        )}

        {!loadError && jobs.map((job) => {
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
                      setActionError(null);
                      try {
                        const body = typeof merged === 'string' ? merged : JSON.stringify(merged);
                        const updated = await updateJobBody(job.id, body);
                        if (!updated) {
                          setActionError('Это изменение уже исчезло из очереди. Список обновлён.');
                          await reload();
                          return;
                        }
                        await retryNow(job.id);
                      } catch (error) {
                        reportError('offline.conflicts.merge', error, { jobId: job.id });
                        setActionError('Не удалось сохранить объединённое изменение. Исходная очередь сохранена.');
                      }
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
                      onPrimary: () => { void removeWithoutSync(job.id); },
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

        {!loadError && jobs.length > 0 && (
          <>
            <PrimaryButton
              title="Убрать точные дубли"
              variant="outline"
              disabled={Boolean(busyId || syncing)}
              onPress={() => { void dedupeNow(); }}
              loading={syncing}
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
  errorCard: { backgroundColor: RenovaTheme.colors.surface, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: RenovaTheme.colors.danger, gap: 10, marginBottom: 12 },
  actionError: { backgroundColor: RenovaTheme.colors.surface, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: RenovaTheme.colors.danger, marginBottom: 12 },
  errorTitle: { fontWeight: '800', fontSize: 15, color: RenovaTheme.colors.danger },
  errorBody: { fontSize: 12, lineHeight: 17, color: RenovaTheme.colors.text },
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
