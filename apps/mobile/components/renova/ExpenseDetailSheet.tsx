/** Детализация расхода — просмотр, правка и удаление */
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { usePathname } from 'expo-router';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ExpenseContextPickers } from '@/components/renova/ExpenseContextPickers';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { api, type OsExpense, type ProjectDetail, type ReceiptItem, type Room, type Stage } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { alertExpenseUpdated, alertExpenseDeleted } from '@/lib/siteOpsNav';
import type { OsRole } from '@/constants/osSections';
import { EXPENSE_CATEGORY_LABEL } from '@/constants/labels';
import type { ExpenseCategoryId } from '@/constants/expenseCategories';
import { pushOsNav } from '@/lib/pushOsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';

export type ExpenseDetailTarget =
  | { kind: 'expense'; item: OsExpense }
  | { kind: 'receipt'; item: ReceiptItem };

export function ExpenseDetailSheet({
  target,
  project,
  rooms,
  stages,
  userId,
  projectId,
  editable,
  onClose,
  onChanged,
}: {
  target: ExpenseDetailTarget | null;
  project?: ProjectDetail | null;
  rooms: Room[];
  stages: Stage[];
  userId?: string;
  projectId?: string;
  editable?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { user, activeProject } = useRenova();
  const pathname = usePathname();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const [amountText, setAmountText] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategoryId>('materials');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationRef = useRef(false);

  useEffect(() => {
    if (!target) return;
    setAmountText(String(target.item.amount));
    if (target.kind === 'receipt') {
      setDescription(target.item.description || '');
      setCategory((target.item.expense_category || 'materials') as ExpenseCategoryId);
      setRoomId(target.item.room_id ?? null);
      setStageId(target.item.stage_id ?? null);
    } else {
      setDescription(target.item.title);
      setCategory((target.item.category || 'materials') as ExpenseCategoryId);
      setRoomId(target.item.room_id ?? null);
      setStageId(target.item.stage_id ?? null);
    }
  }, [target]);

  if (!target) return null;

  const isExpense = target.kind === 'expense';
  const item = target.item;
  const categoryLabel = isExpense
    ? EXPENSE_CATEGORY_LABEL[target.item.category] || target.item.category
    : EXPENSE_CATEGORY_LABEL[target.item.expense_category || 'other'] || target.item.expense_category || '—';
  const date = isExpense ? target.item.expense_date : target.item.receipt_at || target.item.created_at;
  const room = rooms.find((candidate) => candidate.id === (roomId ?? item.room_id));
  const stage = stages.find((candidate) => candidate.id === (stageId ?? item.stage_id));
  const status = isExpense
    ? (target.item.status === 'pending_receipt' ? 'Ждёт чек' : 'Подтверждён')
    : (target.item.verified ? 'Проверен' : 'Не проверен');
  const canDelete = Boolean(editable && userId && projectId);
  const canEdit = canDelete;
  const payerLabel = isExpense ? 'Учёт' : 'Вы';
  const pickerProject = project ?? (rooms.length || stages.length ? { rooms, stages } : null);
  const currentTitle = description.trim() || (isExpense ? target.item.title : target.item.description || 'Чек');

  const closeSafely = () => {
    if (!mutationRef.current) onClose();
  };

  async function saveChanges() {
    if (!userId || !projectId || !target || !canEdit || mutationRef.current) return;
    const amount = Number(amountText.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      showActionConfirm({ title: 'Сумма расхода', message: 'Укажите сумму больше 0.' });
      return;
    }

    mutationRef.current = true;
    setBusy(true);
    try {
      if (target.kind === 'receipt') {
        await api.patchReceipt(userId, projectId, target.item.id, {
          amount,
          description: description.trim() || null,
          expense_category: category,
          room_id: roomId,
          stage_id: stageId,
        });
      } else {
        await api.patchOsExpense(userId, projectId, target.item.id, {
          amount,
          title: description.trim() || target.item.title,
          category,
          room_id: roomId,
          stage_id: stageId,
        });
      }
      await syncProjectSideEffects({
        user: user ?? ({ id: userId } as never),
        project: activeProject ?? project ?? ({ id: projectId } as never),
      });
      onChanged?.();
      onClose();
      alertExpenseUpdated(role);
    } catch (error: unknown) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued('Изменения траты');
        onClose();
        return;
      }
      const message = error && typeof error === 'object' && 'detail' in error
        ? String((error as { detail?: string }).detail)
        : 'Не удалось сохранить изменения. Введённые данные остались в форме.';
      showActionConfirm({ title: 'Изменения не сохранены', message });
    } finally {
      mutationRef.current = false;
      setBusy(false);
    }
  }

  function confirmDelete() {
    if (!userId || !projectId || !target || mutationRef.current) return;
    showActionConfirm({
      title: 'Удалить трату?',
      message: 'Сумма будет убрана из факта бюджета. Отменить это действие после подтверждения нельзя.',
      primaryLabel: 'Удалить трату',
      primaryDestructive: true,
      onPrimary: () => {
        void (async () => {
          if (mutationRef.current) return;
          mutationRef.current = true;
          setBusy(true);
          try {
            if (target.kind === 'receipt') {
              await api.deleteReceipt(userId, projectId, target.item.id);
            } else {
              await api.deleteOsExpense(userId, projectId, target.item.id);
            }
            await syncProjectSideEffects({
              user: user ?? ({ id: userId } as never),
              project: activeProject ?? project ?? ({ id: projectId } as never),
            });
            onChanged?.();
            onClose();
            alertExpenseDeleted(role);
          } catch (error: unknown) {
            if (isOfflineQueued(error)) {
              notifyOfflineQueued('Удаление траты');
              onClose();
            } else {
              const message = error && typeof error === 'object' && 'detail' in error
                ? String((error as { detail?: string }).detail)
                : 'Не удалось удалить трату.';
              showActionConfirm({ title: 'Трата не удалена', message });
            }
          } finally {
            mutationRef.current = false;
            setBusy(false);
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  }

  return (
    <SheetSurface
      visible
      value={formatRub(Number(amountText) || item.amount)}
      title={currentTitle}
      subtitle={`${categoryLabel} · ${status}`}
      busy={busy}
      onClose={closeSafely}
      accessibilityLabel="Детали траты"
      footer={
        <>
          {canEdit ? (
            <PrimaryButton
              title="Сохранить"
              accessibilityLabel="Сохранить изменения траты"
              onPress={() => { void saveChanges(); }}
              loading={busy}
              disabled={busy}
              fullWidth
            />
          ) : null}
          {canDelete ? (
            <PrimaryButton
              title="Удалить трату"
              accessibilityLabel="Удалить трату из бюджета"
              variant="dangerOutline"
              onPress={confirmDelete}
              disabled={busy}
              fullWidth
            />
          ) : null}
          <PrimaryButton
            title="Закрыть"
            accessibilityLabel="Закрыть детали траты"
            variant="ghost"
            onPress={closeSafely}
            disabled={busy}
            fullWidth
          />
        </>
      }
    >
      {canEdit ? (
        <View style={sheetContentStyles.section}>
          <Text style={sheetContentStyles.fieldLabel}>Сумма, ₽</Text>
          <TextInput
            style={sheetContentStyles.input}
            keyboardType="decimal-pad"
            value={amountText}
            onChangeText={setAmountText}
            editable={!busy}
            accessibilityLabel="Сумма траты"
          />
          <Text style={sheetContentStyles.fieldLabel}>{isExpense ? 'Название' : 'Описание'}</Text>
          <TextInput
            style={sheetContentStyles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="За что трата"
            editable={!busy}
            accessibilityLabel={isExpense ? 'Название траты' : 'Описание чека'}
          />
          {pickerProject ? (
            <ExpenseContextPickers
              project={pickerProject}
              roomId={roomId}
              stageId={stageId}
              category={category}
              onRoomChange={setRoomId}
              onStageChange={setStageId}
              onCategoryChange={setCategory}
              disabled={busy}
            />
          ) : null}
        </View>
      ) : null}

      <View style={sheetContentStyles.row}>
        <Text style={sheetContentStyles.label}>Статус</Text>
        <Text style={sheetContentStyles.value}>{status}</Text>
      </View>
      <View style={sheetContentStyles.row}>
        <Text style={sheetContentStyles.label}>Кто платил</Text>
        <Text style={sheetContentStyles.value}>{payerLabel}</Text>
      </View>
      {date ? (
        <View style={sheetContentStyles.row}>
          <Text style={sheetContentStyles.label}>Дата</Text>
          <Text style={sheetContentStyles.value}>{new Date(date).toLocaleDateString('ru-RU')}</Text>
        </View>
      ) : null}
      {room ? (
        <Pressable
          style={sheetContentStyles.row}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Открыть комнату ${room.name}`}
          onPress={() => {
            onClose();
            pushOsNav({ pathname: '/room/[id]', params: { id: room.id } }, pathname, role);
          }}
        >
          <Text style={sheetContentStyles.label}>Комната</Text>
          <Text style={sheetContentStyles.link}>{room.name} →</Text>
        </Pressable>
      ) : null}
      {stage ? (
        <Pressable
          style={sheetContentStyles.row}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Открыть этап ${stage.name}`}
          onPress={() => {
            onClose();
            pushOsNav({ pathname: '/stage/[id]', params: { id: stage.id } }, pathname, role);
          }}
        >
          <Text style={sheetContentStyles.label}>Этап</Text>
          <Text style={sheetContentStyles.link}>{stage.name} →</Text>
        </Pressable>
      ) : null}
      {!isExpense && target.item.fn ? (
        <View style={sheetContentStyles.row}>
          <Text style={sheetContentStyles.label}>ФН</Text>
          <Text style={sheetContentStyles.value}>{target.item.fn}</Text>
        </View>
      ) : null}
      {isExpense && target.item.status === 'pending_receipt' ? (
        <Text style={[sheetContentStyles.note, { color: RenovaTheme.colors.warningText }]}>
          Запись ожидает чек — можно изменить сумму и привязку.
        </Text>
      ) : null}
    </SheetSurface>
  );
}
