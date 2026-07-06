/** Поле «Сколько готов вложить» — wizard и профиль объекта */
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';

type Props = {
  value: string;
  onChange: (v: string) => void;
  estimateTotal?: number;
  hint?: string;
  /** Внутри секции ObjectProfileSection — без своего заголовка */
  embedded?: boolean;
};

export function CustomerBudgetField({ value, onChange, estimateTotal, hint, embedded }: Props) {
  const num = parseInt(value.replace(/\s/g, ''), 10);
  const overEstimate = estimateTotal && num > 0 && num < estimateTotal;

  return (
    <View style={embedded ? s.embedded : s.wrap}>
      {!embedded ? (
        <>
          <Text style={s.title}>Бюджет заказчика</Text>
          <Text style={s.desc}>
            {hint || 'Сколько вы готовы вложить в ремонт. Дальше — контроль факта и перерасхода относительно этого лимита.'}
          </Text>
        </>
      ) : null}
      <TextInput
        style={s.input}
        placeholder="Например: 500000"
        keyboardType="number-pad"
        value={value}
        onChangeText={onChange}
      />
      {estimateTotal != null && estimateTotal > 0 ? (
        <Text style={s.meta}>Смета проекта: {formatRub(estimateTotal)}</Text>
      ) : null}
      {overEstimate ? (
        <Text style={s.warn}>Лимит ниже сметы — возможен перерасход или нужно урезать объём работ.</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginVertical: 12 },
  embedded: { gap: 4 },
  title: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 4 },
  desc: { ...formMetaText.caption, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    fontWeight: '700',
    backgroundColor: RenovaTheme.colors.surface,
  },
  meta: { ...formMetaText.caption, marginTop: 6 },
  warn: { fontSize: 12, color: RenovaTheme.colors.warning, marginTop: 6, lineHeight: 16 },
});
