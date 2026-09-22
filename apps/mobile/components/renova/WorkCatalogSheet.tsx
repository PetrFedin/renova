/** Подбор работ: каталог с фильтром, свои работы и создание этапов пачкой. */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { filterChipStyles, screenTypography } from '@/constants/screenTypography';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { api } from '@/lib/api';
import {
  addCustomWork,
  buildStageDrafts,
  catalogCategories,
  filterWorkCatalog,
  toggleWorkSelection,
  workCategoryLabel,
  type WorkCatalogItem,
} from '@/lib/domain/workCatalog';
import { apiErrorMessage } from '@/lib/formatPhone';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { reportError } from '@/lib/reportError';

type PropagationEvent = { stopPropagation?: () => void };

export function WorkCatalogSheet({
  visible,
  userId,
  projectId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  userId: string;
  projectId: string;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const [items, setItems] = useState<WorkCatalogItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    api
      .listWorkTypes()
      .then((list) => setItems(list))
      .catch((error: unknown) => {
        reportError('components.renova.WorkCatalogSheet.load', error);
        showActionConfirm({
          title: 'Каталог работ недоступен',
          message: 'Не удалось загрузить список работ. Свою работу всё равно можно добавить вручную.',
        });
      })
      .finally(() => setLoading(false));
  }, [visible]);

  const categories = useMemo(() => catalogCategories(items), [items]);
  const visibleItems = useMemo(
    () => filterWorkCatalog(items, query, category),
    [items, query, category],
  );
  const drafts = useMemo(() => buildStageDrafts(items, selected), [items, selected]);

  const reset = () => {
    setSelected([]);
    setQuery('');
    setCategory(null);
    setCustomName('');
  };

  const addOwn = () => {
    const result = addCustomWork(items, customName);
    if (!result.ok) {
      showActionConfirm({ title: 'Своя работа', message: result.message });
      return;
    }
    setItems(result.items);
    setSelected((prev) => (prev.includes(result.code) ? prev : [...prev, result.code]));
    setCustomName('');
  };

  const create = async () => {
    if (busy || !drafts.length) return;
    setBusy(true);
    let created = 0;
    try {
      for (const draft of drafts) {
        await api.createStage(userId, projectId, { name: draft.name, work_type: draft.work_type });
        created += 1;
      }
      await onCreated();
      reset();
      onClose();
      showActionConfirm({
        title: 'Этапы созданы',
        message: `Добавлено этапов: ${created}. Сроки и комнаты можно указать в каждом этапе.`,
      });
    } catch (error: unknown) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued('Этапы');
        await onCreated();
        reset();
        onClose();
        return;
      }
      showActionConfirm({
        title: created ? `Создано этапов: ${created}` : 'Не удалось создать этапы',
        message: apiErrorMessage(error, 'Остальные работы остались отмеченными — попробуйте ещё раз.'),
      });
      await onCreated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(event: PropagationEvent) => event.stopPropagation?.()}>
          <Text style={s.head}>Какие работы планируются</Text>
          <Text style={s.hint}>
            Отметьте работы — на каждую создастся этап ремонта в порядке хода работ.
          </Text>

          <TextInput
            style={s.inp}
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск по работам"
            editable={!busy}
            accessibilityLabel="Поиск по каталогу работ"
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: category === null }}
              accessibilityLabel="Все категории работ"
              style={[filterChipStyles.chip, s.chipTouch, category === null && filterChipStyles.chipOn]}
              onPress={() => setCategory(null)}
            >
              <Text style={[filterChipStyles.chipT, category === null && filterChipStyles.chipTOn]}>Все</Text>
            </Pressable>
            {categories.map((item) => {
              const on = category === item;
              return (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Категория: ${workCategoryLabel(item)}`}
                  style={[filterChipStyles.chip, s.chipTouch, on && filterChipStyles.chipOn]}
                  onPress={() => setCategory(on ? null : item)}
                >
                  <Text style={[filterChipStyles.chipT, on && filterChipStyles.chipTOn]}>
                    {workCategoryLabel(item)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {loading ? <ActivityIndicator style={s.loader} /> : null}

          <ScrollView style={s.list} keyboardShouldPersistTaps="handled">
            {!loading && !visibleItems.length ? (
              <Text style={s.empty}>Ничего не нашлось — добавьте работу своим названием ниже.</Text>
            ) : null}
            {visibleItems.map((item) => {
              const on = selected.includes(item.code);
              return (
                <Pressable
                  key={item.code}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: busy }}
                  accessibilityLabel={item.name}
                  disabled={busy}
                  style={[s.row, on && s.rowOn]}
                  onPress={() => setSelected((prev) => toggleWorkSelection(prev, item.code))}
                >
                  <Text style={[s.rowT, on && s.rowTOn]}>{on ? '✓ ' : ''}{item.name}</Text>
                  <Text style={s.rowMeta}>{item.custom ? 'Своя работа' : workCategoryLabel(item.category)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={s.label}>Своя работа</Text>
          <View style={s.ownRow}>
            <TextInput
              style={[s.inp, s.ownInput]}
              value={customName}
              onChangeText={setCustomName}
              placeholder="Например: Монтаж ниши"
              editable={!busy}
              accessibilityLabel="Название своей работы"
              onSubmitEditing={addOwn}
            />
            <PrimaryButton title="Добавить" variant="outline" compact onPress={addOwn} disabled={busy} />
          </View>

          <PrimaryButton
            title={busy ? 'Создание…' : drafts.length ? `Создать этапы (${drafts.length})` : 'Выберите работы'}
            onPress={() => { void create(); }}
            disabled={busy || !drafts.length}
            fullWidth
          />
          <PrimaryButton title="Закрыть" variant="outline" onPress={onClose} disabled={busy} fullWidth />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: RenovaTheme.radius.xl,
    borderTopRightRadius: RenovaTheme.radius.xl,
    padding: RenovaTheme.spacing.md,
    paddingBottom: RenovaTheme.spacing.xl,
    gap: RenovaTheme.spacing.sm,
    maxHeight: '88%',
  },
  head: { ...screenTypography.section, marginTop: 0 },
  hint: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  label: { ...screenTypography.section, marginTop: 0, marginBottom: 0 },
  inp: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.borderLight,
    borderRadius: RenovaTheme.radius.md,
    paddingHorizontal: RenovaTheme.spacing.sm,
    minHeight: RenovaTheme.minTouch,
    fontSize: RenovaTheme.fontSize.body,
  },
  chipRow: { gap: RenovaTheme.spacing.xs, paddingVertical: RenovaTheme.spacing.xxs },
  chipTouch: { minHeight: RenovaTheme.minTouch, justifyContent: 'center' },
  loader: { paddingVertical: RenovaTheme.spacing.sm },
  list: { maxHeight: 320 },
  empty: {
    fontSize: RenovaTheme.fontSize.bodySmall,
    color: RenovaTheme.colors.textMuted,
    paddingVertical: RenovaTheme.spacing.sm,
  },
  row: {
    minHeight: RenovaTheme.minTouch,
    justifyContent: 'center',
    paddingVertical: RenovaTheme.spacing.sm,
    paddingHorizontal: RenovaTheme.spacing.sm,
    borderRadius: RenovaTheme.radius.md,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.borderLight,
    marginBottom: RenovaTheme.spacing.xs,
  },
  rowOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.accentMuted },
  rowT: { fontSize: RenovaTheme.fontSize.body, fontWeight: '600', color: RenovaTheme.colors.text },
  rowTOn: { color: RenovaTheme.colors.accent },
  rowMeta: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  ownRow: { flexDirection: 'row', alignItems: 'center', gap: RenovaTheme.spacing.sm },
  ownInput: { flex: 1 },
});
