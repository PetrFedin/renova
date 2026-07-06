/** Создание счёта на оплату — исполнитель в «Бюджет → Оплаты» */
import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { StagePickerChips } from '@/components/renova/StagePickerChips';
import { api, type ProjectDetail } from '@/lib/api';

const PAY_TYPES = [
  { id: 'advance', label: 'Аванс' },
  { id: 'stage', label: 'Этап' },
  { id: 'material', label: 'Материалы' },
  { id: 'final', label: 'Финал' },
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
      Alert.alert('Отправлено', 'Счёт отправлен заказчику на подтверждение');
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать счёт');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.box}>
      <Text style={s.head}>Новый счёт</Text>
      <Text style={s.hint}>Заказчик получит уведомление и подтвердит оплату</Text>
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
  box: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 },
  head: { fontWeight: '800', marginBottom: 4 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 10 },
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.borderLight, borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 15 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
});
