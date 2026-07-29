/** Ручной расход: наличные, перевод, без QR */
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ExpenseContextPickers } from '@/components/renova/ExpenseContextPickers';
import { formSurfaceStyles } from '@/constants/formStyles';
import type { ExpenseCategoryId } from '@/constants/expenseCategories';
import { api, type ProjectDetail } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { alertManualExpenseSaved } from '@/lib/receiptNav';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import type { OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportCatch } from '@/lib/reportError';
import { createClientRequestId } from '@/lib/clientRequestId';

export function ManualExpenseForm({
  userId,
  project,
  readOnly,
  onSaved,
  initialRoomId,
  initialStageId,
  collapsed,
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
  const requestIdRef = useRef(createClientRequestId('receipt-manual'));
  const [open, setOpen] = useState(!collapsed);

  const clearDraft = () => {
    setAmount('');
    setDescription('');
  };

  const rotateRequestId = () => {
    requestIdRef.current = createClientRequestId('receipt-manual');
  };

  const submit = async () => {
    if (busyRef.current || readOnly) return;
    const normalizedAmount = Number.parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      showActionConfirm({ title: 'Сумма расхода', message: 'Укажите сумму больше 0.' });
      return;
    }

    busyRef.current = true;
    setBusy(true);
    let saved = false;
    try {
      await api.addManualReceipt(
        userId,
        project.id,
        normalizedAmount,
        description.trim(),
        category,
        roomId,
        stageId,
        null,
        requestIdRef.current,
      );
      saved = true;
    } catch (error) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued('Расход без чека');
        rotateRequestId();
        clearDraft();
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

    if (!saved) return;
    rotateRequestId();
    clearDraft();
    if (collapsed) setOpen(false);
    onSaved?.();
    const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
    alertManualExpenseSaved(role, normalizedAmount);
    void syncProjectSideEffects({ user: user ?? ({ id: userId } as never), project })
      .catch(reportCatch('ManualExpenseForm.sideEffects'));
  };

  if (collapsed && !open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Добавить расход без чека"
        accessibilityState={{ disabled: Boolean(readOnly) }}
        style={formSurfaceStyles.collapsedAction}
        disabled={readOnly}
        onPress={() => setOpen(true)}
      >
        <Text style={formSurfaceStyles.collapsedTitle}>+ Расход без чека</Text>
        <Text style={formSurfaceStyles.collapsedMeta}>Наличные, перевод или расход без QR</Text>
      </Pressable>
    );
  }

  return (
    <View style={formSurfaceStyles.container}>
      <Text style={formSurfaceStyles.title}>Расход без чека</Text>
      <Text style={formSurfaceStyles.hint}>Наличные, перевод или доставка. Привязка к комнате и этапу улучшает фактическую себестоимость.</Text>

      <Text style={formSurfaceStyles.label}>Сумма</Text>
      <TextInput
        style={formSurfaceStyles.input}
        value={amount}
        onChangeText={setAmount}
        placeholder="Сумма, ₽"
        keyboardType="decimal-pad"
        editable={!readOnly && !busy}
        accessibilityLabel="Сумма расхода"
      />

      <Text style={formSurfaceStyles.label}>Описание</Text>
      <TextInput
        style={formSurfaceStyles.input}
        value={description}
        onChangeText={setDescription}
        placeholder="Магазин, работа или назначение"
        editable={!readOnly && !busy}
        accessibilityLabel="Описание расхода"
      />

      <ExpenseContextPickers
        project={project}
        roomId={roomId}
        stageId={stageId}
        category={category}
        onRoomChange={setRoomId}
        onStageChange={setStageId}
        onCategoryChange={setCategory}
        disabled={Boolean(readOnly || busy)}
      />

      <View style={formSurfaceStyles.actionStack}>
        <PrimaryButton
          disabled={Boolean(readOnly || busy)}
          loading={busy}
          title="Добавить расход"
          onPress={() => { void submit(); }}
          fullWidth
        />
        {collapsed ? (
          <PrimaryButton title="Отмена" variant="ghost" disabled={busy} onPress={() => setOpen(false)} fullWidth />
        ) : null}
      </View>
    </View>
  );
}
