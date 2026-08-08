/** Ручной расход: наличные, перевод, без QR */
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ExpenseContextPickers } from '@/components/renova/ExpenseContextPickers';
import { formSurfaceStyles } from '@/constants/formStyles';
import type { ExpenseCategoryId } from '@/constants/expenseCategories';
import { api, type ProjectDetail, type ReceiptItem } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { alertManualExpenseSaved } from '@/lib/receiptNav';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import type { OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportCatch, reportError } from '@/lib/reportError';
import { createClientRequestId } from '@/lib/clientRequestId';

export function ManualExpenseForm({
  userId,
  project,
  readOnly,
  onSaved,
  initialRoomId,
  initialStageId,
  initialDescription,
  collapsed,
}: {
  userId: string;
  project: ProjectDetail;
  readOnly?: boolean;
  onSaved?: (receipt: ReceiptItem) => void | Promise<void>;
  initialRoomId?: string | null;
  initialStageId?: string | null;
  initialDescription?: string;
  /** На экране списка/скана форма может быть свёрнута, чтобы сначала показать операции. */
  collapsed?: boolean;
}) {
  const { user, activeProject, loadProject } = useRenova();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [category, setCategory] = useState<ExpenseCategoryId>('materials');
  const [roomId, setRoomId] = useState<string | null>(initialRoomId ?? null);
  const [stageId, setStageId] = useState<string | null>(initialStageId ?? null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestIdRef = useRef(createClientRequestId('receipt-manual'));
  const [open, setOpen] = useState(!collapsed);
  const contextRef = useRef({ userId: user?.id ?? null, projectId: activeProject?.id ?? null });
  contextRef.current = { userId: user?.id ?? null, projectId: activeProject?.id ?? null };

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
    let savedReceipt: ReceiptItem | null = null;
    try {
      savedReceipt = await api.addManualReceipt(
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

    if (!savedReceipt) return;

    rotateRequestId();
    clearDraft();
    if (collapsed) setOpen(false);
    const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
    alertManualExpenseSaved(role, normalizedAmount);

    try {
      await onSaved?.(savedReceipt);
    } catch (error) {
      reportError('ManualExpenseForm.onSaved', error, { projectId: project.id, receiptId: savedReceipt.id });
    }

    const current = contextRef.current;
    if (current.userId === userId && current.projectId === project.id) {
      void loadProject(project.id).catch(reportCatch('ManualExpenseForm.projectRefresh'));
    } else {
      reportError(
        'ManualExpenseForm.ContextChangedAfterCommit',
        new Error('active expense context changed after receipt commit'),
        { projectId: project.id, receiptId: savedReceipt.id, currentProjectId: current.projectId },
      );
    }
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