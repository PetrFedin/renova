import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, type WorkSchedule } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { RenovaTheme } from '@/constants/Theme';
import { reportError } from '@/lib/reportError';

export function TechnicalSupervisionScheduleReview() {
  const { user, activeProject } = useRenova();
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupervisor = activeProject?.access_mode === 'supervisor';
  const canReview = Boolean(
    isSupervisor
    && activeProject?.technical_capabilities?.includes('schedule_review'),
  );

  const load = useCallback(async () => {
    if (!user?.id || !activeProject?.id || !canReview) return;
    setLoading(true);
    setError(null);
    try {
      setSchedule(await api.getActiveWorkSchedule(user.id, activeProject.id));
    } catch (cause) {
      reportError('technicalSupervision.schedule.load', cause, { projectId: activeProject.id });
      setError('Не удалось загрузить план-график для технической проверки.');
    } finally {
      setLoading(false);
    }
  }, [activeProject?.id, canReview, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canReview || !user || !activeProject) return null;
  const userId = user.id;
  const projectId = activeProject.id;

  function rejectSchedule() {
    if (!schedule || schedule.status !== 'submitted') return;
    const cleanReason = reason.trim();
    if (!cleanReason) {
      Alert.alert('План-график', 'Укажите техническую причину возврата графика.');
      return;
    }
    const scheduleId = schedule.id;
    Alert.alert(
      'Вернуть график на доработку?',
      'Исполнитель получит причину возврата. Согласовать график от имени заказчика технадзор не может.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Вернуть',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              const next = await api.rejectWorkSchedule(
                userId,
                projectId,
                scheduleId,
                cleanReason,
              );
              setSchedule(next);
              setReason('');
            } catch (cause) {
              reportError('technicalSupervision.schedule.reject', cause, {
                projectId,
                scheduleId,
              });
              setError('Не удалось вернуть график. Обновите данные и повторите действие.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>Техническая проверка графика</Text>
        <Text style={s.boundary}>Без права согласования от имени заказчика</Text>
      </View>
      {loading ? <Text style={s.muted}>Загрузка графика…</Text> : null}
      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} disabled={loading || busy}>
            <Text style={s.retry}>Повторить</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && !error && !schedule ? (
        <Text style={s.muted}>Активный план-график ещё не создан.</Text>
      ) : null}
      {!loading && !error && schedule ? (
        <>
          <Text style={s.planTitle}>{schedule.title}</Text>
          <Text style={s.muted}>Статус: {schedule.status}</Text>
          {schedule.status === 'submitted' ? (
            <>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Причина: сроки, последовательность, технологический риск…"
                placeholderTextColor={RenovaTheme.colors.textSubtle}
                style={s.input}
                editable={!busy}
                multiline
              />
              <Pressable
                onPress={rejectSchedule}
                disabled={busy || !reason.trim()}
                style={[s.rejectButton, (busy || !reason.trim()) && s.disabled]}
              >
                <Text style={s.rejectText}>{busy ? 'Возврат…' : 'Вернуть график на доработку'}</Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 12, marginTop: 8, padding: 12, borderRadius: RenovaTheme.radius.lg, borderWidth: 1, borderColor: RenovaTheme.colors.infoBorder, backgroundColor: RenovaTheme.colors.infoBg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, fontSize: RenovaTheme.fontSize.body, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  boundary: { maxWidth: 130, fontSize: RenovaTheme.fontSize.tiny, color: RenovaTheme.colors.infoText, textAlign: 'right' },
  planTitle: { marginTop: 8, fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.text },
  muted: { marginTop: 6, fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  input: { minHeight: 62, marginTop: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: RenovaTheme.radius.sm, backgroundColor: RenovaTheme.colors.surface, color: RenovaTheme.colors.text, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: 'top' },
  rejectButton: { minHeight: 44, marginTop: 8, borderWidth: 1, borderColor: RenovaTheme.colors.dangerBorder, borderRadius: RenovaTheme.radius.sm, backgroundColor: RenovaTheme.colors.dangerBg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  rejectText: { color: RenovaTheme.colors.dangerText, fontWeight: RenovaTheme.fontWeight.semibold },
  disabled: { opacity: 0.5 },
  errorBox: { marginTop: 8 },
  errorText: { color: RenovaTheme.colors.dangerText, fontSize: RenovaTheme.fontSize.caption },
  retry: { marginTop: 5, color: RenovaTheme.colors.primary, fontWeight: RenovaTheme.fontWeight.semibold },
});
