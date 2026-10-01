import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { notifyError } from '@/lib/notify';
import { reportError } from '@/lib/reportError';

type Msg = { id: string; user_id: string; text: string; at: string };

function stamp(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Чат заявки (MKT-010). Backend открывает его заказчику и назначенному исполнителю,
 * поэтому до выбора исполнителя (`available=false`) честно говорим, когда он появится,
 * а не показываем поле, в которое нельзя писать.
 */
export function LeadChat({ userId, leadId, available = true }: { userId: string; leadId: string; available?: boolean }) {
  const { user, activeProject } = useRenova();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setMsgs(await api.leadMessages(userId, leadId));
      setLoadFailed(false);
    } catch (error) {
      reportError('components.renova.LeadChat.1', error, { leadId });
      setLoadFailed(true);
    }
  }, [userId, leadId]);
  useEffect(() => { if (available) void load(); }, [available, load]);

  if (!available) {
    return (
      <View style={s.box}>
        <Text style={s.hint}>Чат откроется, когда заказчик выберет исполнителя.</Text>
      </View>
    );
  }

  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await api.postLeadMessage(userId, leadId, value);
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
      {loadFailed ? <Text style={s.hint}>Не удалось загрузить переписку. Показаны последние данные.</Text> : null}
      {msgs.map((m) => (
        <View key={m.id} style={s.msg}>
          <Text style={s.who}>{m.user_id === userId ? 'Вы' : 'Собеседник'} · {stamp(m.at)}</Text>
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
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 8, marginVertical: 6 },
});
