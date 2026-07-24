/** Ручной расход: наличные, перевод, без QR */
import { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ExpenseContextPickers } from '@/components/renova/ExpenseContextPickers';
import type { ExpenseCategoryId } from '@/constants/expenseCategories';
import { api } from '@/lib/api';
import type { ProjectDetail } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { alertManualExpenseSaved } from '@/lib/receiptNav';
import type { OsRole } from '@/constants/osSections';

export function ManualExpenseForm({
  userId, project, readOnly, onSaved, initialRoomId, initialStageId, collapsed,
}: {
  userId: string;
  project: ProjectDetail;
  readOnly?: boolean;
  onSaved?: () => void;
  initialRoomId?: string | null;
  initialStageId?: string | null;
  /** На экране скана — форма свёрнута, чтобы не дублировать pickers */
  collapsed?: boolean;
}) {
  const { user } = useRenova();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategoryId>('materials');
  const [roomId, setRoomId] = useState<string | null>(initialRoomId ?? null);
  const [stageId, setStageId] = useState<string | null>(initialStageId ?? null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!collapsed);

  // Контекст комнаты/этапа может измениться в родительском экране после монтирования
  // (например, пользователь сначала выбирает его в сканере, затем раскрывает ручной расход).
  useEffect(() => {
    setRoomId(initialRoomId ?? null);
  }, [initialRoomId, project.id]);

  useEffect(() => {
    setStageId(initialStageId ?? null);
  }, [initialStageId, project.id]);

  async function submit() {
    const n = parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert('Сумма', 'Укажите сумму больше 0');
      return;
    }

    setBusy(true);
    try {
      await api.addManualReceipt(userId, project.id, n, description.trim(), category, roomId, stageId);
      setAmount('');
      setDescription('');
      await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project });
      onSaved?.();
      const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
      alertManualExpenseSaved(role, n);
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить расход');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.box}>
      {collapsed && !open ? (
        <Pressable onPress={() => setOpen(true)} disabled={readOnly || busy}>
          <Text style={[s.link, (readOnly || busy) && s.linkDisabled]}>+ Расход без чека (наличные, перевод)</Text>
        </Pressable>
      ) : (
        <>
          <Text style={s.head}>Расход без чека</Text>
          <Text style={s.hint}>Наличные, перевод, доставка — оплата: вы. Привяжите к комнате и этапу; попадёт в факт как чек.</Text>
          <TextInput style={s.inp} value={amount} onChangeText={setAmount} placeholder="Сумма, ₽" keyboardType="decimal-pad" editable={!readOnly && !busy} />
          <TextInput style={s.inp} value={description} onChangeText={setDescription} placeholder="Описание (магазин, работа…)" editable={!readOnly && !busy} />
          <ExpenseContextPickers
            project={project}
            roomId={roomId}
            stageId={stageId}
            category={category}
            onRoomChange={setRoomId}
            onStageChange={setStageId}
            onCategoryChange={setCategory}
            disabled={readOnly || busy}
          />
          <PrimaryButton disabled={readOnly || busy || !amount.trim()} title={busy ? 'Сохранение…' : 'Добавить расход'} variant="outline" onPress={submit} />
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
  head: { fontWeight: '800', marginBottom: 4 },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 10 },
  link: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary, paddingVertical: 4 },
  linkDisabled: { opacity: 0.5 },
  inp: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 8 },
});
