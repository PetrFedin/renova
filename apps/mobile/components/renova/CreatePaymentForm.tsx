/** Создание счёта на оплату — исполнитель в «Бюджет → Оплаты» */
import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { StagePickerChips } from '@/components/renova/StagePickerChips';
import { api, type ProjectDetail } from '@/lib/api';

/** Backend: contractor может создавать только stage/material (payments.py). */
const PAY_TYPES = [
  { id: 'stage', label: 'Этап' },
  { id: 'material', label: 'Материалы' },
] as const;

export function CreatePaymentForm({
  userId,
  project,
  onSaved,
}: {
  userId: string;
  project: ProjectDetail;
  onSaved?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState<(typeof PAY_TYPES)[number]['id']>('stage');
  const [stageId, setStageId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = parseFloat(amount.replace(',', '.'));
    if (!title.trim()) { Alert.alert('Счёт', 'Укажите название'); return; }
    if (!n || n <= 0) { Alert.alert('Счёт', 'Укажите сумму больше 0'); return; }
    if (paymentType === 'stage' && !stageId) {
      Alert.alert('Счёт', 'Выберите этап для счёта за этап');
      return;
    }
    setBusy(true);
    try {
      await api.createPayment(userId, project.id, {
        title: title.trim(),
        amount: n,
        payment_type: paymentType,
        stage_id: stageId,
        notes: notes.trim() || null,
      });
      setTitle('');
      setAmount('');
      setNotes('');
      onSaved?.();
      Alert.alert('Счёт создан', 'Заказчику отправлено уведомление об оплате');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      Alert.alert(
        'Ошибка',
        msg.includes('403') || msg.includes('Forbidden')
          ? 'Этот тип счёта недоступен исполнителю. Используйте «Этап» или «Материалы».'
          : 'Не удалось создать счёт',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.box}>
      <Text style={s.head}>Новый счёт</Text>
      <Text style={s.hint}>Только этап или материалы. Заказчик подтвердит оплату.</Text>
      <TextInput style={s.inp} value={title} onChangeText={setTitle} placeholder="Название (например: Штукатурка)" editable={!busy} />
      <TextInput style={s.inp} value={amount} onChangeText={setAmount} placeholder="Сумма, ₽" keyboardType="decimal-pad" editable={!busy} />
      <View style={s.typeRow}>
        {PAY_TYPES.map((t) => (
          <PrimaryButton
            key={t.id}
            title={t.label}
            compact
            variant={paymentType === t.id ? 'primary' : 'outline'}
            onPress={() => setPaymentType(t.id)}
          />
        ))}
      </View>
      {project.stages?.length ? (
        <StagePickerChips stages={project.stages} value={stageId} onChange={setStageId} />
      ) : null}
      <TextInput style={s.inp} value={notes} onChangeText={setNotes} placeholder="Комментарий (необязательно)" editable={!busy} />
      <PrimaryButton title={busy ? 'Отправка…' : 'Выставить счёт'} onPress={submit} disabled={busy} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 10, marginBottom: 16, padding: 12, borderRadius: 12, backgroundColor: RenovaTheme.colors.surface },
  head: { fontSize: 16, fontWeight: '800', color: RenovaTheme.colors.text },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 4 },
  inp: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.background,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
