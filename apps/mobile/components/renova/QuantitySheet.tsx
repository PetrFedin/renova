import { useEffect, useState } from 'react';
import { Text, TextInput, StyleSheet, View } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { parsePositiveNumber } from '@/lib/parseLocaleNumber';
import { reportCatch } from '@/lib/reportError';

/**
 * Лист «сколько закупать» при согласовании подбора (EST-013): у позиции подбора нет
 * количества, и без этого листа закупка получалась бы на 1 шт.
 * Остаётся открытым, пока идёт запрос; при ошибке (onConfirm → false) значения сохраняются.
 */
export function QuantitySheet({
  visible,
  title,
  hint,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  hint: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (qty: number, unit: string) => Promise<boolean> | boolean;
}) {
  const [qtyText, setQtyText] = useState('1');
  const [unit, setUnit] = useState('шт');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setQtyText('1'); setUnit('шт'); } }, [visible]);
  const qty = parsePositiveNumber(qtyText);
  const cleanUnit = unit.trim();
  const valid = qty !== null && cleanUnit.length > 0 && cleanUnit.length <= 16;
  const close = () => { if (!busy) onClose(); };
  const submit = async () => {
    if (!valid || qty === null || busy) return;
    setBusy(true);
    try {
      if (await onConfirm(qty, cleanUnit)) onClose();
    } catch (e) {
      reportCatch('components.renova.QuantitySheet.confirm')(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SheetSurface
      visible={visible}
      onClose={close}
      busy={busy}
      title={title}
      footer={
        <>
          <PrimaryButton title={confirmLabel} variant="accent" loading={busy} disabled={!valid} onPress={() => { void submit(); }} />
          <PrimaryButton title="Отмена" variant="ghost" disabled={busy} onPress={close} />
        </>
      }
    >
      <View style={s.row}>
        <TextInput
          accessibilityLabel="Количество к закупке"
          style={[sheetContentStyles.input, s.qty]}
          placeholder="Количество"
          value={qtyText}
          onChangeText={setQtyText}
          keyboardType="decimal-pad"
          editable={!busy}
        />
        <TextInput
          accessibilityLabel="Единица измерения"
          style={[sheetContentStyles.input, s.unit]}
          placeholder="Ед."
          value={unit}
          onChangeText={setUnit}
          editable={!busy}
        />
      </View>
      <Text style={s.hint}>{valid ? hint : 'Введите количество больше 0 и единицу (шт, м², кг…).'}</Text>
    </SheetSurface>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  qty: { flex: 2 },
  unit: { flex: 1 },
  hint: { color: RenovaTheme.colors.textMuted, fontSize: RenovaTheme.fontSize.bodySmall },
});
