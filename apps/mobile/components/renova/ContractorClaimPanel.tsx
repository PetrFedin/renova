/** Исполнитель: заявка на объект по коду и статус «Ожидает подтверждения заказчика» */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { notifyError } from '@/lib/notify';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { StatusPill } from '@/components/ui/StatusPill';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { AssignmentRequest } from '@/lib/api/assignmentRequests';
import { apiErrorMessage } from '@/lib/formatPhone';
import { reportCatch } from '@/lib/reportError';
import { useProjectDataReload } from '@/lib/useProjectDataReload';

export function ContractorClaimPanel({ userId }: { userId: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<AssignmentRequest[]>([]);

  const reload = useCallback(() => {
    api
      .listMyAssignmentRequests(userId)
      .then((r) => setItems(r.items))
      .catch(reportCatch('components.renova.ContractorClaimPanel.1'));
  }, [userId]);
  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  const send = async () => {
    const clean = code.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await api.claimProjectByCode(userId, clean);
      setCode('');
      reload();
    } catch (e: unknown) {
      notifyError('Не удалось отправить заявку', e, 'Проверьте подключение');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.box}>
      <Text style={s.hint}>Код объекта даёт заказчик. Вы станете исполнителем только после его подтверждения.</Text>
      <TextInput
        style={s.input}
        value={code}
        onChangeText={setCode}
        placeholder="Код объекта"
        placeholderTextColor={RenovaTheme.colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={16}
      />
      <PrimaryButton
        title={busy ? '…' : 'Предложить вести проект'}
        variant="accent"
        compact
        disabled={busy || !code.trim()}
        onPress={send}
      />
      {items.map((item) => (
        <View key={item.id} style={s.row}>
          <Text style={s.name} numberOfLines={1}>{item.project_name || 'Объект'}</Text>
          {item.status === 'pending' ? (
            <StatusPill label="Ожидает подтверждения заказчика" tone="warning" />
          ) : (
            <StatusPill label="Заказчик отклонил" tone="danger" />
          )}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 8 },
  hint: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  input: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 14, color: RenovaTheme.colors.text },
});
