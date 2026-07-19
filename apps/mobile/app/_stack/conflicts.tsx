/** Offline conflicts 409 — разрешение очереди */
import { useState, useCallback } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { OfflineDiffViewer } from '@/components/renova/OfflineDiffViewer';
import { FieldMergePicker } from '@/components/renova/FieldMergePicker';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { dedupeQueue } from '@/lib/smartMerge';
import { flush, getQueue, removeJob, type OfflineJob } from '@/lib/offlineQueue';
import { RenovaTheme } from '@/constants/Theme';
import { offlineJobLabel, offlineJobPreview } from '@/lib/offlineJobLabel';

export default function ConflictsScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [jobs, setJobs] = useState<OfflineJob[]>([]);

  const reload = useCallback(async () => {
    setJobs(await getQueue());
  }, []);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));

  return (
    <>
      <BackHeader title="Конфликты синхронизации" returnTo={returnTo} subtitle={`${jobs.length} в очереди`} />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={s.hint}>Изменения сохранены локально. При 409 выберите версию или удалите запрос.</Text>
        {jobs.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyT}>Очередь пуста</Text>
            <Text style={s.emptySub}>Все изменения синхронизированы с сервером.</Text>
          </View>
        )}
        {jobs.map((j) => (
          <View key={j.id} style={s.card}>
            <Text style={s.path}>{offlineJobLabel(j)}</Text>
            <Text style={s.preview}>{offlineJobPreview(j)}</Text>
            <Text style={s.meta}>{new Date(j.ts).toLocaleString('ru-RU')}</Text>
            <OfflineDiffViewer local={j.body} />
            <FieldMergePicker local={j.body} onMerge={async (m) => {
              const next = jobs.map((x) => (x.id === j.id ? { ...x, body: m } : x));
              const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
              await AsyncStorage.setItem('renova_offline_queue', JSON.stringify(next));
              setJobs(next);
            }} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <PrimaryButton title="Удалить" variant="outline" onPress={async () => { await removeJob(j.id); await reload(); }} />
            </View>
          </View>
        ))}
        {jobs.length > 0 && (
          <>
            <PrimaryButton title="Умное слияние" variant="outline" onPress={async () => {
              const deduped = dedupeQueue(jobs);
              const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
              await AsyncStorage.setItem('renova_offline_queue', JSON.stringify(deduped));
              setJobs(deduped);
            }} />
            <View style={{ height: 8 }} />
            <PrimaryButton title="Синхронизировать сейчас" onPress={async () => {
              const apiBase = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
              await flush(apiBase);
              await reload();
            }} />
          </>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  hint: { color: RenovaTheme.colors.textMuted, marginBottom: 12, lineHeight: 18, fontSize: 13 },
  empty: { ...{ backgroundColor: RenovaTheme.colors.surface, padding: 24, borderRadius: 12, alignItems: 'center' } },
  emptyT: { fontWeight: '700', fontSize: 16 },
  emptySub: { color: RenovaTheme.colors.textMuted, marginTop: 6, textAlign: 'center' },
  card: { backgroundColor: RenovaTheme.colors.surface, padding: 12, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  path: { fontWeight: '700', fontSize: 13 },
  meta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginVertical: 4 },
  preview: { fontSize: 12, color: RenovaTheme.colors.text, marginBottom: 4 },
});
