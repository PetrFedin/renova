import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { notifyError } from '@/lib/notify';
import { reportError } from '@/lib/reportError';
import { parseServerInstant } from '@/lib/formatScheduleDate';

type Msg = { id: string; user_id: string; text: string; at: string };

function stamp(at: string): string {
  const date = parseServerInstant(at);
  if (!date) return '';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

type Thread = { contractor_id: string; name: string; assigned: boolean; message_count: number };

/**
 * Чат заявки (MKT-010): приватные треды «заказчик ↔ откликнувшийся исполнитель».
 * Заказчик выбирает собеседника из откликнувшихся и видит каждый тред отдельно;
 * исполнитель видит один тред со своим заказчиком и пишет после отклика.
 */
export function LeadChat({
  userId,
  leadId,
  role,
  available = true,
}: {
  userId: string;
  leadId: string;
  role: 'customer' | 'contractor';
  /** Заказчик: есть отклики/назначенный. Исполнитель: отклик оставлен или он назначен. */
  available?: boolean;
}) {
  const { user, activeProject } = useRenova();
  const isCustomer = role === 'customer';
  const [threads, setThreads] = useState<Thread[]>([]);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!available || !isCustomer) return;
    void (async () => {
      try {
        const list = await api.leadThreads(userId, leadId);
        setThreads(list);
        setPeerId((prev) => prev ?? list.find((t) => t.assigned)?.contractor_id ?? list[0]?.contractor_id ?? null);
      } catch (error) {
        reportError('components.renova.LeadChat.threads', error, { leadId });
      }
    })();
  }, [available, isCustomer, userId, leadId]);

  const load = useCallback(async () => {
    if (isCustomer && !peerId) return;
    try {
      setMsgs(await api.leadMessages(userId, leadId, isCustomer ? peerId ?? undefined : undefined));
      setLoadFailed(false);
    } catch (error) {
      reportError('components.renova.LeadChat.1', error, { leadId });
      setLoadFailed(true);
    }
  }, [userId, leadId, isCustomer, peerId]);
  useEffect(() => { if (available) void load(); }, [available, load]);

  if (!available) {
    return (
      <View style={s.box}>
        <Text style={s.hint}>
          {isCustomer ? 'Чат откроется, когда придёт первый отклик исполнителя.' : 'Заказчик ответит после отклика.'}
        </Text>
      </View>
    );
  }

  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await api.postLeadMessage(userId, leadId, value, isCustomer ? peerId ?? undefined : undefined);
    } catch (error) {
      reportError('components.renova.LeadChat.send', error, { leadId });
      notifyError('Сообщение не отправлено', error);
      setBusy(false);
      return;
    }
    setText('');
    setBusy(false);
    try {
      await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject });
    } catch (error) {
      reportError('components.renova.LeadChat.sync', error, { leadId });
    }
    void load();
  };

  return (
    <View style={s.box}>
      {isCustomer && threads.length > 0 ? (
        <View style={s.peers}>
          {threads.map((t, i) => (
            <PrimaryButton
              key={t.contractor_id}
              title={`${t.name === 'Исполнитель' ? `Исполнитель ${i + 1}` : t.name}${t.assigned ? ' · выбран' : ''}`}
              compact
              variant={peerId === t.contractor_id ? 'primary' : 'outline'}
              onPress={() => setPeerId(t.contractor_id)}
            />
          ))}
        </View>
      ) : null}
      {loadFailed ? <Text style={s.hint}>Не удалось загрузить переписку. Показаны последние данные.</Text> : null}
      {msgs.map((m) => (
        <View key={m.id} style={s.msg}>
          <Text style={s.who}>{m.user_id === userId ? 'Вы' : isCustomer ? 'Исполнитель' : 'Заказчик'} · {stamp(m.at)}</Text>
          <Text style={s.m}>{m.text}</Text>
        </View>
      ))}
      <TextInput style={s.inp} value={text} onChangeText={setText} placeholder="Сообщение" editable={!busy} />
      <PrimaryButton title="Отправить" loading={busy} disabled={busy || !text.trim()} onPress={send} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginTop: 8, padding: 8, backgroundColor: RenovaTheme.colors.background, borderRadius: 8 },
  msg: { marginBottom: 6 },
  who: { fontSize: 11, color: RenovaTheme.colors.textMuted },
  m: { fontSize: 12 },
  peers: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 8, marginVertical: 6 },
});
