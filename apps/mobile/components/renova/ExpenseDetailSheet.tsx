/** Детализация расхода — просмотр, правка и удаление */
import { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, TextInput, Alert } from 'react-native';
import { router, usePathname } from 'expo-router';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ExpenseContextPickers } from '@/components/renova/ExpenseContextPickers';
import { api, type OsExpense, type ProjectDetail, type ReceiptItem, type Room, type Stage } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { EXPENSE_CATEGORY_LABEL } from '@/constants/labels';
import type { ExpenseCategoryId } from '@/constants/expenseCategories';

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
  const [amountText, setAmountText] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategoryId>('materials');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  const date = isExpense
    ? target.item.expense_date
    : target.item.receipt_at || target.item.created_at;
  const room = rooms.find((r) => r.id === (roomId ?? item.room_id));
  const stage = stages.find((st) => st.id === (stageId ?? item.stage_id));
  const status = isExpense
    ? (target.item.status === 'pending_receipt' ? 'Ждёт чек' : 'Подтверждён')
    : (target.item.verified ? 'Проверен' : 'Не проверен');
  const canDelete = !!editable && !!userId && !!projectId;
  const canEdit = canDelete;
  const payerLabel = isExpense ? 'Учёт' : 'Вы';
  const pickerProject = project ?? (rooms.length || stages.length ? { rooms, stages } : null);

  async function saveChanges() {
    if (!userId || !projectId || !target || !canEdit) return;
    const amount = Number(amountText.replace(',', '.'));
    if (!amount || amount <= 0) {
      Alert.alert('Сумма', 'Укажите корректную сумму');
      return;
    }
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
        user: user ?? ({ id: userId } as any),
        project: activeProject ?? project ?? ({ id: projectId } as any),
      });
      onChanged?.();
      onClose();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'detail' in e ? String((e as { detail?: string }).detail) : 'Не удалось сохранить изменения';
      Alert.alert('Ошибка', msg);
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    if (!userId || !projectId || !target) return;
    Alert.alert('Удалить трату?', 'Сумма будет убрана из факта бюджета.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            if (target.kind === 'receipt') {
              await api.deleteReceipt(userId, projectId, target.item.id);
            } else {
              await api.deleteOsExpense(userId, projectId, target.item.id);
            }
            await syncProjectSideEffects({
              user: user ?? ({ id: userId } as any),
              project: activeProject ?? project ?? ({ id: projectId } as any),
            });
            onChanged?.();
            onClose();
          } catch (e: unknown) {
            const msg = e && typeof e === 'object' && 'detail' in e ? String((e as { detail?: string }).detail) : 'Не удалось удалить';
            Alert.alert('Ошибка', msg);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.head}>{formatRub(Number(amountText) || item.amount)}</Text>
          {canEdit ? (
            <>
              <Text style={s.label}>Сумма, ₽</Text>
              <TextInput style={s.input} keyboardType="decimal-pad" value={amountText} onChangeText={setAmountText} editable={!busy} />
              <Text style={s.label}>{isExpense ? 'Название' : 'Описание'}</Text>
              <TextInput style={s.input} value={description} onChangeText={setDescription} placeholder="За что трата" editable={!busy} />
              {pickerProject && (
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
              )}
            </>
          ) : (
            <Text style={s.title}>{isExpense ? target.item.title : (target.item.description || 'Чек')}</Text>
          )}
          {!canEdit && (
            <View style={s.row}><Text style={s.label}>Статья</Text><Text style={s.val}>{categoryLabel}</Text></View>
          )}
          <View style={s.row}><Text style={s.label}>Статус</Text><Text style={s.val}>{status}</Text></View>
          <View style={s.row}>
            <Text style={s.label}>Кто платил</Text>
            <Text style={s.val}>{payerLabel}</Text>
          </View>
          {date ? (
            <View style={s.row}>
              <Text style={s.label}>Дата</Text>
              <Text style={s.val}>{new Date(date).toLocaleDateString('ru-RU')}</Text>
            </View>
          ) : null}
          {room ? (
            <View style={s.row}>
              <Text style={s.label}>Комната</Text>
              <Pressable onPress={() => { onClose(); router.push({ pathname: `/room/${room.id}`, params: { returnTo: pathname } } as any); }}>
                <Text style={s.link}>{room.name}</Text>
              </Pressable>
            </View>
          ) : null}
          {stage ? (
            <View style={s.row}>
              <Text style={s.label}>Этап</Text>
              <Pressable onPress={() => { onClose(); router.push({ pathname: `/stage/${stage.id}`, params: { returnTo: pathname } } as any); }}>
                <Text style={s.link}>{stage.name}</Text>
              </Pressable>
            </View>
          ) : null}
          {!isExpense && target.item.fn ? (
            <View style={s.row}><Text style={s.label}>ФН</Text><Text style={s.val}>{target.item.fn}</Text></View>
          ) : null}
          {isExpense && target.item.status === 'pending_receipt' && (
            <Text style={s.note}>Запись ожидает чек — можно изменить сумму и привязку.</Text>
          )}
          {canEdit && (
            <PrimaryButton title={busy ? 'Сохраняем…' : 'Сохранить'} onPress={saveChanges} disabled={busy} />
          )}
          {canDelete && (
            <PrimaryButton title="Удалить" variant="outline" onPress={confirmDelete} disabled={busy} />
          )}
          <PrimaryButton title="Закрыть" variant="outline" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { ...card, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 28, gap: 8 },
  head: { fontSize: 22, fontWeight: '700', color: RenovaTheme.colors.text },
  title: { fontSize: 16, fontWeight: '600', marginTop: 4, marginBottom: 12, color: RenovaTheme.colors.textMuted },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  label: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  val: { fontSize: 13, fontWeight: '600' },
  link: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.primary },
  input: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 10, backgroundColor: RenovaTheme.colors.surface },
  note: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
});
