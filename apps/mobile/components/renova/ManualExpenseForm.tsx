/** Ручной расход: наличные, перевод, без QR */
import { useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ExpenseContextPickers } from '@/components/renova/ExpenseContextPickers';
import type { ExpenseCategoryId } from '@/constants/expenseCategories';
import { api } from '@/lib/api';
import type { ProjectDetail } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { alertManualExpenseSaved } from '@/lib/receiptNav';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import type { OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

export function ManualExpenseForm({
  userId, project, readOnly, onSaved, initialRoomId, initialStageId, collapsed,
}: {
  userId: string;
  project: ProjectDetail;
  readOnly?: boolean;
  onSaved?: () => void;
  initialRoomId?: string | null;
  initialStageId?: string | null;
  /** На экране списка/скана форма может быть свёрнута, чтобы сначала показать операции. */
  collapsed?: boolean;
}) {
  const { user } = useRenova();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategoryId>('materials');
  const [roomId, setRoomId] = useState<string | null>(initialRoomId ?? null);
  const [stageId, setStageId] = useState<string | null>(initialStageId ?? null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [open, setOpen] = useState(!collapsed);

  const submit = async () => {
    if (busyRef.current || readOnly) return;
    const normalizedAmount = Number.parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      showActionConfirm({ title: 'Сумма расхода', message: 'Укажите сумму больше 0.' });
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      await api.addManualReceipt(
        userId,
        project.id,
        normalizedAmount,
        description.trim(),
        category,
        roomId,
        stageId,
      );
      await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project });
      setAmount('');
      setDescription('');
      onSaved?.();
      if (collapsed) setOpen(false);
      const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
      alertManualExpenseSaved(role, normalizedAmount);
    } catch (error) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued('Расход без чека');
        setAmount('');
        setDescription('');
        if (collapsed) setOpen(false);
      } else {
        showActionConfirm({
          title: 'Не удалось сохранить расход',
          message: 'Введённые данные сохранены в форме. Проверьте сеть и повторите.',
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (collapsed && !open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Добавить расход без чека"
        style={s.collapsedButton}
        disabled={readOnly}
        onPress={() => setOpen(true)}
      >
        <Text style={s.link}>+ Расход без чека</Text>
        <Text style={s.collapsedMeta}>Наличные, перевод или расход без QR</Text>
      </Pressable>
    );
  }

  return (
    <View style={s.box}>
      <Text style={s.head}>Расход без чека</Text>
      <Text style={s.hint}>Наличные, перевод или доставка. Привязка к комнате и этапу улучшает фактическую себестоимость.</Text>

      <Text style={s.label}>Сумма</Text>
      <TextInput
        style={s.inp}
        value={amount}
        onChangeText={setAmount}
        placeholder="Сумма, ₽"
        keyboardType="decimal-pad"
        editable={!readOnly && !busy}
      />

      <Text style={s.label}>Описание</Text>
      <TextInput
        style={s.inp}
        value={description}
        onChangeText={setDescription}
        placeholder="Магазин, работа или назначение"
        editable={!readOnly && !busy}
      />

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

      <PrimaryButton
        disabled={readOnly || busy}
        loading={busy}
        title="Добавить расход"
        onPress={() => { void submit(); }}
        fullWidth
      />
      {collapsed ? (
        <PrimaryButton
          title="Отмена"
          variant="ghost"
          disabled={busy}
          onPress={() => setOpen(false)}
          fullWidth
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    paddingVertical: 14,
    marginBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RenovaTheme.colors.border,
    gap: 8,
  },
  head: { ...screenTypography.listTitle, fontSize: 16 },
  hint: { ...screenTypography.listMeta, marginBottom: 4 },
  label: { ...screenTypography.section, marginTop: 4, marginBottom: 2 },
  collapsedButton: {
    minHeight: RenovaTheme.minTouch,
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RenovaTheme.colors.border,
  },
  link: { ...screenTypography.listLink, marginTop: 0 },
  collapsedMeta: { ...screenTypography.listMeta },
  inp: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: RenovaTheme.minTouch,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.surface,
  },
});
