/** Поля профиля проекта — wizard создания и редактирование в «Объект → Профиль» */
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { normalizeIsoDateInput } from '@/lib/validateDate';
import { ObjectProfileSection } from '@/components/screens/object/ObjectProfileSection';
import { CustomerBudgetField } from '@/components/renova/CustomerBudgetField';

const RENOVATION_TYPES = [
  { id: 'cosmetic', label: 'Косметический' },
  { id: 'capital', label: 'Капитальный' },
  { id: 'bathroom', label: 'Ванная' },
  { id: 'kitchen', label: 'Кухня' },
] as const;

const PROPERTY_TYPES = [
  { id: 'apartment' as const, label: 'Квартира' },
  { id: 'house' as const, label: 'Дом' },
] as const;

export type ProjectProfileValues = {
  name: string;
  address: string;
  renovation_type: string;
  property_type: 'apartment' | 'house';
  planned_start_date?: string;
  planned_end_date?: string;
};

type Props = {
  values: ProjectProfileValues;
  onChange: (patch: Partial<ProjectProfileValues>) => void;
  /** Даты проекта — в профиле объекта, в wizard необязательно */
  showSchedule?: boolean;
  /** profile — секции hub; wizard — компактный поток без бюджета */
  variant?: 'profile' | 'wizard';
  budgetValue?: string;
  onBudgetChange?: (v: string) => void;
  estimateTotal?: number;
};

function FieldLabel({ children }: { children: string }) {
  return <Text style={s.fieldLabel}>{children}</Text>;
}

function ChipRow({
  items,
  value,
  onSelect,
}: {
  items: readonly { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={s.chipRow}>
      {items.map((item) => {
        const on = value === item.id;
        return (
          <Pressable key={item.id} style={[s.chip, on && s.chipOn]} onPress={() => onSelect(item.id)}>
            <Text style={[s.chipT, on && s.chipTOn]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProjectProfileFields({
  values,
  onChange,
  showSchedule,
  variant = 'wizard',
  budgetValue,
  onBudgetChange,
  estimateTotal,
}: Props) {
  const isProfile = variant === 'profile';

  const objectBlock = (
    <>
      <FieldLabel>Название</FieldLabel>
      <TextInput
        style={s.input}
        placeholder="Например: Демо-дом, дачный посёлок"
        value={values.name}
        onChangeText={(name) => onChange({ name })}
      />
      <FieldLabel>Адрес</FieldLabel>
      <TextInput
        style={s.input}
        placeholder="Улица, дом"
        value={values.address}
        onChangeText={(address) => onChange({ address })}
      />
      <FieldLabel>Тип жилья</FieldLabel>
      <ChipRow
        items={PROPERTY_TYPES}
        value={values.property_type}
        onSelect={(id) => onChange({ property_type: id as 'apartment' | 'house' })}
      />
    </>
  );

  const renovationBlock = (
    <>
      <FieldLabel>Базовый тип ремонта</FieldLabel>
      <ChipRow
        items={RENOVATION_TYPES}
        value={values.renovation_type}
        onSelect={(renovation_type) => onChange({ renovation_type })}
      />
      {isProfile ? null : (
        <Text style={s.inlineHint}>Тип комнаты на следующем шаге может переопределить расчёт.</Text>
      )}
    </>
  );

  const scheduleBlock = showSchedule ? (
    <>
      <FieldLabel>Сроки</FieldLabel>
      <View style={s.dateRow}>
        <View style={s.dateCol}>
          <TextInput
            style={s.dateInput}
            placeholder="2026-06-01"
            value={values.planned_start_date || ''}
            onChangeText={(v) => onChange({ planned_start_date: normalizeIsoDateInput(v) })}
          />
          <Text style={s.dateHint}>Старт</Text>
        </View>
        <View style={s.dateCol}>
          <TextInput
            style={s.dateInput}
            placeholder="2026-09-01"
            value={values.planned_end_date || ''}
            onChangeText={(v) => onChange({ planned_end_date: normalizeIsoDateInput(v) })}
          />
          <Text style={s.dateHint}>Финиш</Text>
        </View>
      </View>
    </>
  ) : null;

  const budgetBlock =
    isProfile && budgetValue != null && onBudgetChange ? (
      <CustomerBudgetField
        embedded
        value={budgetValue}
        onChange={onBudgetChange}
        estimateTotal={estimateTotal}
      />
    ) : null;

  if (isProfile) {
    return (
      <View>
        <ObjectProfileSection title="Объект">{objectBlock}</ObjectProfileSection>
        <ObjectProfileSection
          title="Ремонт"
          hint="Тип комнаты (кухня, ванная) может уточнить расчёт на шаге «Комнаты»."
        >
          {renovationBlock}
        </ObjectProfileSection>
        {showSchedule ? (
          <ObjectProfileSection title="Сроки" hint="Формат YYYY-MM-DD. Влияет на план и календарь.">
            {scheduleBlock}
          </ObjectProfileSection>
        ) : null}
        {budgetBlock ? (
          <ObjectProfileSection title="Бюджет" hint="Лимит вложений — синхронизируется между устройствами.">
            {budgetBlock}
          </ObjectProfileSection>
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <Text style={s.sectionTitle}>Профиль объекта</Text>
      <Text style={s.sectionHint}>Название обязательно. Адрес и сроки можно уточнить позже.</Text>
      {objectBlock}
      {renovationBlock}
      {scheduleBlock}
    </View>
  );
}

const s = StyleSheet.create({
  sectionTitle: { fontSize: 18, fontWeight: '800', color: RenovaTheme.colors.text, marginBottom: 4 },
  sectionHint: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 16, lineHeight: 18 },
  fieldLabel: { fontWeight: '600', marginBottom: 4, color: RenovaTheme.colors.text, fontSize: 13 },
  inlineHint: { fontSize: 12, color: RenovaTheme.colors.textSubtle, lineHeight: 16 },
  input: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
    backgroundColor: RenovaTheme.colors.surface,
    fontSize: 16,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  chipOn: { borderColor: RenovaTheme.colors.primary, backgroundColor: '#EFF6FF' },
  chipT: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  chipTOn: { color: RenovaTheme.colors.primary },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateCol: { flex: 1 },
  dateInput: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 10,
    padding: 12,
    backgroundColor: RenovaTheme.colors.surface,
    fontSize: 14,
  },
  dateHint: { fontSize: 11, color: RenovaTheme.colors.textSubtle, marginTop: 4 },
});
