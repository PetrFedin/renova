/** Форма задачи из чата — название, ответственный, срок */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api } from '@/lib/api';
import { createClientRequestId } from '@/lib/clientRequestId';
import { getFailureStatus } from '@/lib/api/failurePolicy';
import type { ChatTaskInput } from '@/lib/api/chatCommands';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportError } from '@/lib/reportError';

const DUE_PRESETS = [
  { label: 'Завтра', days: 1 },
  { label: '3 дня', days: 3 },
  { label: 'Неделя', days: 7 },
  { label: '2 недели', days: 14 },
];

function stopPropagation(event: unknown): void {
  if (typeof event !== 'object' || event === null || !('stopPropagation' in event)) return;
  const stop = event.stopPropagation;
  if (typeof stop === 'function') stop.call(event);
}

export function ChatTaskSheet({
  visible,
  defaultTitle,
  userId,
  commandContext,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  defaultTitle: string;
  userId: string;
  commandContext: string;
  onClose: () => void;
  onSubmit: (body: ChatTaskInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [dueDays, setDueDays] = useState(3);
  const [assigneeId, setAssigneeId] = useState<string | undefined>();
  const [members, setMembers] = useState<{ user_id: string; phone: string; role: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [retained, setRetained] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const currentContext = useRef(commandContext);
  currentContext.current = commandContext;
  const intentRef = useRef<{ context: string; body: ChatTaskInput } | null>(null);
  const openedContext = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!visible || openedContext.current === commandContext) return;
    openedContext.current = commandContext;
    intentRef.current = null;
    setTitle(defaultTitle);
    setDueDays(3);
    setAssigneeId(undefined);
    setFailure(null);
    setRetained(false);
  }, [visible, commandContext, defaultTitle]);

  const reloadMembers = useCallback(() => {
    if (!visible) return;
    let cancelled = false;
    api.getTeam(userId).then((t) => {
      if (!cancelled && mounted.current && currentContext.current === commandContext) setMembers(t?.members || []);
    }).catch((e) => {
      reportError('components.renova.chat.ChatTaskSheet.Members', e);
      if (!cancelled && mounted.current && currentContext.current === commandContext) setMembers([]);
    });
    return () => { cancelled = true; };
  }, [visible, userId, commandContext]);
  useEffect(reloadMembers, [reloadMembers]);
  useProjectDataReload(() => { reloadMembers(); });

  const close = () => { if (!busyRef.current) onClose(); };
  const locked = busy || retained;
  async function save() {
    if (busyRef.current || !title.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    const due = new Date();
    due.setDate(due.getDate() + dueDays);
    // A calendar date, not UTC conversion of a local day. Freeze it on FIRST submit.
    const due_at = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    const previous = intentRef.current;
    const intent = previous?.context === commandContext ? previous : {
      context: commandContext,
      body: { title: title.trim(), assignee_id: assigneeId, due_at, client_request_id: createClientRequestId('chat-task') },
    };
    intentRef.current = intent;
    const isCurrent = () => mounted.current && currentContext.current === commandContext;
    try {
      await onSubmit(intent.body);
      if (!isCurrent()) return;
      intentRef.current = null;
      setRetained(false);
      onClose();
    } catch (error) {
      if (!isCurrent()) return;
      reportError('ChatTaskSheet.Submit', error);
      const status = getFailureStatus(error);
      const refused = status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
      if (refused) {
        intentRef.current = null;
        setRetained(false);
        setFailure('Сервер отклонил запрос. Проверьте права и ответственного.');
      } else {
        setRetained(true);
        setFailure(status === 409
          ? 'Задача уже связана с сообщением или запрос изменился. Закройте форму и обновите чат.'
          : 'Результат не подтверждён. Повтор использует исходный запрос без создания дубля.');
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={s.sheet} onPress={stopPropagation}>
          <Text style={s.head}>Задача из сообщения</Text>
          <TextInput style={s.inp} value={title} editable={!locked} maxLength={255} onChangeText={setTitle} placeholder="Название задачи" />
          <Text style={s.label}>Срок</Text>
          <View style={s.row}>
            {DUE_PRESETS.map((p) => (
              <PrimaryButton
                key={p.days}
                title={p.label}
                compact
                variant={dueDays === p.days ? 'outline' : 'ghost'}
                disabled={locked}
                onPress={() => setDueDays(p.days)}
              />
            ))}
          </View>
          {members.length > 0 && (
            <>
              <Text style={s.label}>Ответственный</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.members}>
                <Pressable disabled={locked} style={[s.chip, !assigneeId && s.chipOn]} onPress={() => setAssigneeId(undefined)}>
                  <Text style={s.chipT}>Не назначен</Text>
                </Pressable>
                {members.map((m) => (
                  <Pressable key={m.user_id} disabled={locked} style={[s.chip, assigneeId === m.user_id && s.chipOn]} onPress={() => setAssigneeId(m.user_id)}>
                    <Text style={s.chipT}>{m.phone.slice(-4)} · {m.role}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
          {failure ? <Text accessibilityRole="alert" style={s.failure}>{failure}</Text> : null}
          <PrimaryButton loading={busy} title={busy ? 'Создание…' : retained ? 'Повторить исходный запрос' : 'Создать задачу'} onPress={() => { void save(); }} disabled={busy || !title.trim()} />
          <PrimaryButton title="Отмена" variant="outline" disabled={busy} onPress={close} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: RenovaTheme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
  head: { ...screenTypography.sheetTitle, marginBottom: RenovaTheme.spacing.md },
  failure: { ...screenTypography.sheetSubtitle, color: RenovaTheme.colors.dangerText, marginBottom: RenovaTheme.spacing.md },
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.borderLight, borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 15 },
  label: { ...screenTypography.section, marginTop: 0, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  members: { gap: 6, marginBottom: 12 },
  chip: { minHeight: RenovaTheme.minTouch, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: RenovaTheme.colors.border, marginRight: 6 },
  chipOn: { backgroundColor: RenovaTheme.colors.primary },
  chipT: { fontSize: 12, fontWeight: '600' },
});
