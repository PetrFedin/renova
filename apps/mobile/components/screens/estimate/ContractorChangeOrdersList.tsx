/** Доп. работы исполнителя со статусами — OBJ-05: раньше отправленное «в никуда», ответ заказчика не виден. */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { changeOrderPaymentLine, changeOrderStageLine, changeOrderStatusLabel } from '@/constants/labels';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import type { ChangeOrder } from '@/lib/api';

type Props = {
  orders: ChangeOrder[];
  /** `null` — список ещё не загружен */
  loaded: boolean;
  failed: boolean;
  stageName: (stageId?: string | null) => string | null;
  onRetry: () => void;
};

export function ContractorChangeOrdersList({ orders, loaded, failed, stageName, onRetry }: Props) {
  if (failed && !orders.length) {
    return (
      <LoadErrorState
        title="Не удалось загрузить доп. работы"
        hint="Пустой список здесь не означает, что вы ничего не отправляли. Проверьте сеть и повторите."
        onRetry={onRetry}
      />
    );
  }
  if (!loaded && !orders.length) return <Text style={s.hint}>Загружаем доп. работы…</Text>;
  if (!orders.length) return <Text style={s.hint}>Вы ещё не отправляли доп. работы заказчику.</Text>;
  return (
    <View>
      {failed ? (
        <>
          <Text style={s.warn}>Список мог устареть — обновить не удалось.</Text>
          <PrimaryButton title="Повторить загрузку" variant="outline" compact onPress={onRetry} />
        </>
      ) : null}
      {orders.map((o) => {
        const payment = changeOrderPaymentLine(o.status, o.payment_status);
        const stage = changeOrderStageLine(stageName(o.stage_id));
        return (
          <View key={o.id} style={s.row}>
            <View style={s.main}>
              <Text style={s.title}>{o.title}</Text>
              <Text style={s.meta}>{[changeOrderStatusLabel(o.status), stage, payment].filter(Boolean).join(' · ')}</Text>
            </View>
            <Text style={s.sum}>{formatRub(o.amount)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 17 },
  warn: { fontSize: 12, color: RenovaTheme.colors.warningText, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  main: { flex: 1 },
  title: { fontWeight: '700', fontSize: 14, color: RenovaTheme.colors.text },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  sum: { fontWeight: '800', fontSize: 14, color: RenovaTheme.colors.primary },
});
