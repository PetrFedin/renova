/** Форма создания заявки заказчиком (W140) — вместо демо-хардкода 55 м² / 800k */
import { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { metaCaptionStyle } from '@/constants/formTypography';

const RENOVATION_TYPES = [
  { id: 'cosmetic', label: 'Косметический' },
  { id: 'capital', label: 'Капитальный' },
  { id: 'bathroom', label: 'Ванная' },
  { id: 'kitchen', label: 'Кухня' },
] as const;

export type JobLeadCreateBody = {
  title: string;
  address?: string;
  area_sqm?: number;
  renovation_type: string;
  budget_hint?: number;
  description?: string;
};

const TITLE_BY_TYPE: Record<string, string> = {
  cosmetic: 'Косметический ремонт',
  capital: 'Капитальный ремонт',
  bathroom: 'Ремонт ванной',
  kitchen: 'Ремонт кухни',
};

function parsePositive(raw: string): number | undefined {
  const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function CreateJobLeadSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (body: JobLeadCreateBody) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [budget, setBudget] = useState('');
  const [description, setDescription] = useState('');
  const [renovationType, setRenovationType] = useState<string>('cosmetic');
  const [titleTouched, setTitleTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(TITLE_BY_TYPE.cosmetic);
    setAddress('');
    setArea('');
    setBudget('');
    setDescription('');
    setRenovationType('cosmetic');
    setTitleTouched(false);
    setBusy(false);
  }, [visible]);
  const pickType = (id: string) => {
    setRenovationType(id);
    if (!titleTouched || !title.trim()) {
      setTitle(TITLE_BY_TYPE[id] || 'Ремонт');
    }
  };

  async function submit() {
    const t = title.trim() || TITLE_BY_TYPE[renovationType] || 'Ремонт';
    const areaSqm = parsePositive(area);
    const budgetHint = parsePositive(budget);
    if (!area.trim() || areaSqm == null) {
      Alert.alert('Площадь', 'Укажите площадь объекта в м²');
      return;
    }
    if (!budget.trim() || budgetHint == null) {
      Alert.alert('Бюджет', 'Укажите ориентировочный бюджет в ₽');
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        title: t,
        address: address.trim() || undefined,
        area_sqm: areaSqm,
        renovation_type: renovationType,
        budget_hint: budgetHint,
        description: description.trim() || undefined,
      });
      onClose();
    } catch (e: unknown) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось создать заявку');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={s.backdrop} onPress={onClose}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={s.head}>Новая заявка</Text>
              <Text style={s.hint}>Исполнители увидят объект и смогут прислать КП.</Text>

              <Text style={s.label}>Тип ремонта</Text>
              <View style={s.chipRow}>
                {RENOVATION_TYPES.map((item) => {
                  const on = renovationType === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      style={[s.chip, on && s.chipOn]}
                      onPress={() => pickType(item.id)}
                    >
                      <Text style={[s.chipT, on && s.chipTOn]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.label}>Название</Text>
              <TextInput
                style={s.inp}
                value={title}
                onChangeText={(v) => {
                  setTitleTouched(true);
                  setTitle(v);
                }}
                placeholder="Например: Ремонт двушки"
                placeholderTextColor={RenovaTheme.colors.textSubtle}
              />

              <Text style={s.label}>Адрес</Text>
              <TextInput
                style={s.inp}
                value={address}
                onChangeText={setAddress}
                placeholder="Город, улица, дом (необязательно)"
                placeholderTextColor={RenovaTheme.colors.textSubtle}
              />

              <Text style={s.label}>Площадь, м²</Text>
              <TextInput
                style={s.inp}
                value={area}
                onChangeText={setArea}
                keyboardType="decimal-pad"
                placeholder="Например: 62"
                placeholderTextColor={RenovaTheme.colors.textSubtle}
              />

              <Text style={s.label}>Бюджет, ₽</Text>
              <TextInput
                style={s.inp}
                value={budget}
                onChangeText={setBudget}
                keyboardType="number-pad"
                placeholder="Ориентир для исполнителей"
                placeholderTextColor={RenovaTheme.colors.textSubtle}
              />

              <Text style={s.label}>Комментарий</Text>
              <TextInput
                style={[s.inp, s.area]}
                value={description}
                onChangeText={setDescription}
                placeholder="Сроки, пожелания, этаж…"
                placeholderTextColor={RenovaTheme.colors.textSubtle}
                multiline
              />

              <PrimaryButton
                title={busy ? 'Создание…' : 'Создать заявку'}
                onPress={() => {
                  submit().catch(() => {});
                }}
                disabled={busy}
              />
              <PrimaryButton title="Отмена" variant="outline" onPress={onClose} disabled={busy} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  head: { fontSize: 17, fontWeight: '800', marginBottom: 4, color: RenovaTheme.colors.text },
  hint: { ...metaCaptionStyle, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted, marginBottom: 4 },
  inp: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.borderLight,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    fontSize: 15,
    color: RenovaTheme.colors.text,
  },
  area: { minHeight: 72, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
  },
  chipOn: {
    borderColor: RenovaTheme.colors.accent,
    backgroundColor: RenovaTheme.colors.accentMuted,
  },
  chipT: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  chipTOn: { color: RenovaTheme.colors.accent },
});
