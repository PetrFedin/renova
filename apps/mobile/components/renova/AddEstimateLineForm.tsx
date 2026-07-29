/** Добавление строки в смету — работа или материал */
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RoomPickerChips } from '@/components/renova/RoomPickerChips';
import { formSurfaceStyles } from '@/constants/formStyles';
import { filterChipStyles } from '@/constants/screenTypography';
import { EXPENSE_CATEGORIES } from '@/constants/expenseCategories';
import { WORK_TYPES_FALLBACK, type WorkTypeOption } from '@/constants/workCatalog';
import { api, type ProjectDetail } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { alertEstimateLineAdded } from '@/lib/fieldCommsNav';
import type { OsRole } from '@/constants/osSections';
import { reportCatch } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';

const UNITS = ['pcs', 'm2', 'm', 'kg', 'l', 'компл'] as const;

export function AddEstimateLineForm({
  userId,
  project,
  onSaved,
  collapsed,
}: {
  userId: string;
  project: ProjectDetail;
  onSaved?: () => void;
  collapsed?: boolean;
}) {
  const { user } = useRenova();
  const [open, setOpen] = useState(!collapsed);
  const [lineType, setLineType] = useState<'work' | 'material'>('work');
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState<(typeof UNITS)[number]>('pcs');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [category, setCategory] = useState('custom');
  const [notes, setNotes] = useState('');
  const [workTypes, setWorkTypes] = useState<WorkTypeOption[]>(WORK_TYPES_FALLBACK);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    api.listWorkTypes().then(setWorkTypes).catch(() => setWorkTypes(WORK_TYPES_FALLBACK));
  }, []);

  useEffect(() => {
    if (lineType === 'material') setCategory('materials');
    else setCategory('custom');
  }, [lineType]);

  const clearDraft = () => {
    setName('');
    setQty('1');
    setPrice('');
    setNotes('');
    setRoomId(null);
  };

  async function submit() {
    if (busyRef.current) return;
    const quantityPlanned = Number.parseFloat(qty.replace(',', '.'));
    const parsedPrice = Number.parseFloat(price.replace(',', '.'));
    const unitPrice = Number.isFinite(parsedPrice) ? parsedPrice : 0;

    if (!name.trim()) {
      showActionConfirm({ title: 'Название строки', message: 'Укажите работу или материал.' });
      return;
    }
    if (!Number.isFinite(quantityPlanned) || quantityPlanned <= 0) {
      showActionConfirm({ title: 'Количество', message: 'Укажите количество больше 0.' });
      return;
    }
    if (unitPrice < 0) {
      showActionConfirm({ title: 'Цена', message: 'Цена не может быть отрицательной.' });
      return;
    }

    const room = project.rooms?.find((candidate) => candidate.id === roomId);
    busyRef.current = true;
    setBusy(true);
    let saved = false;
    try {
      await api.addEstimateLine(userId, project.id, {
        line_type: lineType,
        name: name.trim(),
        unit,
        quantity_planned: quantityPlanned,
        unit_price: unitPrice,
        room_id: roomId,
        room_name: room?.name || null,
        category,
        notes: notes.trim() || null,
      });
      saved = true;
    } catch (error: unknown) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued('Строка сметы');
        clearDraft();
        if (collapsed) setOpen(false);
      } else {
        showActionConfirm({
          title: 'Строка не добавлена',
          message: 'Введённые данные сохранены в форме. Проверьте сеть и повторите.',
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }

    if (!saved) return;
    clearDraft();
    if (collapsed) setOpen(false);
    onSaved?.();
    alertEstimateLineAdded((user?.role === 'customer' ? 'customer' : 'contractor') as OsRole);
    void syncProjectSideEffects({ user: user ?? ({ id: userId } as never), project })
      .catch(reportCatch('AddEstimateLineForm.sideEffects'));
  }

  if (collapsed && !open) {
    return (
      <PrimaryButton
        title="+ Строка сметы"
        variant="outline"
        onPress={() => setOpen(true)}
        accessibilityLabel="Добавить строку сметы"
        fullWidth
      />
    );
  }

  const categoryOptions = lineType === 'work'
    ? workTypes
    : EXPENSE_CATEGORIES.map((item) => ({ code: item.id, name: item.label, category: item.id }));

  return (
    <View style={formSurfaceStyles.container}>
      <Text style={formSurfaceStyles.title}>Новая строка сметы</Text>
      <Text style={formSurfaceStyles.hint}>Работа или материал с количеством, ценой и привязкой к комнате.</Text>

      <Text style={formSurfaceStyles.label}>Тип строки</Text>
      <View style={filterChipStyles.row}>
        {(['work', 'material'] as const).map((type) => {
          const selected = lineType === type;
          const label = type === 'work' ? 'Работа' : 'Материал';
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityLabel={`Тип строки: ${label}`}
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              style={[filterChipStyles.chip, formSurfaceStyles.chipTouch, selected && filterChipStyles.chipOn]}
              onPress={() => setLineType(type)}
            >
              <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={formSurfaceStyles.label}>Название</Text>
      <TextInput
        style={formSurfaceStyles.input}
        value={name}
        onChangeText={setName}
        placeholder="Название работы или материала"
        editable={!busy}
        accessibilityLabel="Название строки сметы"
      />

      <View style={formSurfaceStyles.splitRow}>
        <View style={formSurfaceStyles.splitCell}>
          <Text style={formSurfaceStyles.label}>Количество</Text>
          <TextInput
            style={formSurfaceStyles.input}
            value={qty}
            onChangeText={setQty}
            placeholder="Количество"
            keyboardType="decimal-pad"
            editable={!busy}
            accessibilityLabel="Количество"
          />
        </View>
        <View style={formSurfaceStyles.splitCell}>
          <Text style={formSurfaceStyles.label}>Цена, ₽</Text>
          <TextInput
            style={formSurfaceStyles.input}
            value={price}
            onChangeText={setPrice}
            placeholder="0"
            keyboardType="decimal-pad"
            editable={!busy}
            accessibilityLabel="Цена за единицу"
          />
        </View>
      </View>

      <Text style={formSurfaceStyles.label}>Единица</Text>
      <View style={filterChipStyles.row}>
        {UNITS.map((option) => {
          const selected = unit === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={`Единица измерения: ${option}`}
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              style={[filterChipStyles.chip, formSurfaceStyles.chipTouch, selected && filterChipStyles.chipOn]}
              onPress={() => setUnit(option)}
            >
              <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={formSurfaceStyles.label}>Статья</Text>
      <View style={filterChipStyles.row}>
        {categoryOptions.slice(0, 12).map((option) => {
          const selected = category === option.code;
          return (
            <Pressable
              key={option.code}
              accessibilityRole="button"
              accessibilityLabel={`Статья: ${option.name}`}
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              style={[filterChipStyles.chip, formSurfaceStyles.chipTouch, selected && filterChipStyles.chipOn]}
              onPress={() => setCategory(option.code)}
            >
              <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]} numberOfLines={1}>
                {option.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {(project.rooms?.length ?? 0) > 0 ? (
        <RoomPickerChips rooms={project.rooms!} value={roomId} onChange={setRoomId} optional disabled={busy} />
      ) : null}

      <Text style={formSurfaceStyles.label}>Заметка</Text>
      <TextInput
        style={[formSurfaceStyles.input, formSurfaceStyles.multilineInput]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Бренд, артикул, условия…"
        multiline
        editable={!busy}
        accessibilityLabel="Заметка к строке сметы"
      />

      <View style={formSurfaceStyles.actionStack}>
        <PrimaryButton
          title="Добавить в смету"
          onPress={() => { void submit(); }}
          loading={busy}
          disabled={busy}
          fullWidth
        />
        {collapsed ? (
          <PrimaryButton title="Отмена" variant="ghost" onPress={() => setOpen(false)} disabled={busy} fullWidth />
        ) : null}
      </View>
    </View>
  );
}
