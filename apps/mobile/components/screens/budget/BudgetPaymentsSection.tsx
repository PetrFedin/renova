/** Вкладка «Бюджет → Оплаты» — create, фильтры, история */
import { View, Text, Pressable } from 'react-native';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { CreatePaymentForm } from '@/components/renova/CreatePaymentForm';
import { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL } from '@/constants/labels';
import type { Payment, ProjectDetail } from '@/lib/api';
import type { PaymentFilter } from '@/lib/hooks/useOsBudgetScreen';
import type { OsRole } from '@/constants/osSections';
import { budgetScreenStyles as s } from '@/components/screens/budget/budgetScreenStyles';

type Props = {
  role: OsRole;
  userId: string;
  project: ProjectDetail;
  readOnly: boolean;
  canWrite: boolean;
  payFilter: PaymentFilter;
  setPayFilter: (f: PaymentFilter) => void;
  filteredPayments: Payment[];
  onPaymentPress: (p: Payment) => void;
  onSaved: () => void;
};

export function BudgetPaymentsSection({
  role, userId, project, readOnly, canWrite, payFilter, setPayFilter, filteredPayments, onPaymentPress, onSaved,
}: Props) {
  return (
    <>
      {role === 'contractor' && canWrite && !readOnly && (
        <CreatePaymentForm userId={userId} project={project} onSaved={onSaved} />
      )}
      <Text style={s.dataHint}>
        Счета подрядчикам — это оплата работ, не закупка материалов. Расходы на чеки и материалы — вкладка «Расходы».
      </Text>
      <Text style={s.section}>Счета и история</Text>
      <View style={s.filterRow}>
        {(['all', 'pending', 'confirmed'] as PaymentFilter[]).map((f) => (
          <PrimaryButton
            key={f}
            compact
            title={f === 'all' ? 'Все' : f === 'pending' ? 'Ожидают' : 'Оплачено'}
            variant={payFilter === f ? 'primary' : 'outline'}
            onPress={() => setPayFilter(f)}
          />
        ))}
      </View>
      {!filteredPayments.length && (
        <Text style={s.empty}>
          {payFilter === 'pending' ? 'Нет ожидающих оплат' : payFilter === 'confirmed' ? 'История оплат пуста' : 'Счетов пока нет'}
        </Text>
      )}
      {filteredPayments.map((p) => (
        <Pressable key={p.id} style={s.row} onPress={() => onPaymentPress(p)}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>{p.title}</Text>
            <Text style={s.rowMeta}>
              {PAYMENT_TYPE_LABEL[p.payment_type] || p.payment_type} · {formatRub(p.amount)}
              {p.confirmed_at ? ` · ${new Date(p.confirmed_at).toLocaleDateString('ru-RU')}` : ''}
            </Text>
          </View>
          <Text style={[s.status, p.status === 'pending' && { color: RenovaTheme.colors.warning }]}>
            {PAYMENT_STATUS_LABEL[p.status] || p.status}
          </Text>
        </Pressable>
      ))}
    </>
  );
}
