/** Вкладка «Бюджет → Оплаты» — создание, фильтры, история */
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import { filterChipStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { CreatePaymentForm } from '@/components/renova/CreatePaymentForm';
import { BankStatementImportSheet } from '@/components/renova/BankStatementImportSheet';
import { PaymentEvidenceSheet } from '@/components/renova/PaymentEvidenceSheet';
import { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL } from '@/constants/labels';
import type { Payment, ProjectDetail } from '@/lib/api';
import type { PaymentFilter } from '@/lib/hooks/useOsBudgetScreen';
import type { OsRole } from '@/constants/osSections';
import { budgetScreenStyles as s } from '@/components/screens/budget/budgetScreenStyles';

const PAYMENT_FILTERS: { id: PaymentFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'Ожидают' },
  { id: 'paid_unverified', label: 'На проверке' },
  { id: 'confirmed', label: 'Оплачено' },
];

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

function emptyLabel(filter: PaymentFilter): string {
  if (filter === 'pending') return 'Нет счетов, ожидающих оплаты.';
  if (filter === 'paid_unverified') return 'Нет ручных переводов, ожидающих проверки.';
  if (filter === 'confirmed') return 'Подтверждённых оплат пока нет.';
  return 'Счетов пока нет.';
}

function formatConfirmedDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('ru-RU');
}

export function BudgetPaymentsSection({
  role, userId, project, readOnly, canWrite, payFilter, setPayFilter, filteredPayments, onPaymentPress, onSaved,
}: Props) {
  const [bankOpen, setBankOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [evidencePayment, setEvidencePayment] = useState<Payment | null>(null);
  const canOperate = canWrite && !readOnly;
  const canCreate = role === 'contractor' && canOperate;

  const handleSaved = () => {
    setCreateOpen(false);
    onSaved();
  };

  return (
    <>
      <Text style={s.dataHint}>
        Счета — оплата работ или материалов исполнителю. Ручной перевод учитывается в подтверждённом факте только после проверки подтверждающего файла.
      </Text>

      {canOperate ? (
        <View style={s.actions}>
          {canCreate ? (
            <PrimaryButton title={createOpen ? 'Скрыть форму' : 'Выставить счёт'} variant={createOpen ? 'outline' : 'primary'} onPress={() => setCreateOpen((value) => !value)} />
          ) : null}
          <PrimaryButton title="Импорт выписки" variant="outline" onPress={() => setBankOpen(true)} />
        </View>
      ) : null}

      {canCreate && createOpen ? (
        <CreatePaymentForm userId={userId} project={project} onSaved={handleSaved} onCancel={() => setCreateOpen(false)} />
      ) : null}

      <Text style={s.section}>Счета и история</Text>
      <View style={filterChipStyles.row}>
        {PAYMENT_FILTERS.map((filter) => {
          const selected = payFilter === filter.id;
          return (
            <Pressable key={filter.id} accessibilityRole="button" accessibilityLabel={`Фильтр оплат: ${filter.label}`} accessibilityState={{ selected }} style={[filterChipStyles.chip, { minHeight: RenovaTheme.minTouch, justifyContent: 'center' }, selected && filterChipStyles.chipOn]} onPress={() => setPayFilter(filter.id)}>
              <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{filter.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {!filteredPayments.length ? (
        <View style={{ paddingVertical: 16 }}>
          <Text style={s.empty}>{emptyLabel(payFilter)}</Text>
          {payFilter !== 'all' ? <PrimaryButton title="Показать все счета" variant="ghost" onPress={() => setPayFilter('all')} /> : null}
        </View>
      ) : null}

      {filteredPayments.map((payment) => {
        const confirmedDate = formatConfirmedDate(payment.confirmed_at);
        const statusColor = payment.status === 'pending' || payment.status === 'paid_unverified'
          ? RenovaTheme.colors.warning
          : payment.status === 'confirmed' ? RenovaTheme.colors.success : RenovaTheme.colors.textMuted;
        return (
          <View key={payment.id}>
            <Pressable style={s.row} accessibilityRole="button" accessibilityLabel={`Открыть счёт ${payment.title}, ${formatRub(payment.amount)}`} onPress={() => onPaymentPress(payment)}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{payment.title}</Text>
                <Text style={s.rowMeta}>
                  {PAYMENT_TYPE_LABEL[payment.payment_type] || payment.payment_type} · {formatRub(payment.amount)}
                  {confirmedDate ? ` · ${confirmedDate}` : ''}
                </Text>
              </View>
              <Text style={[s.status, { color: statusColor }]}>{PAYMENT_STATUS_LABEL[payment.status] || payment.status}</Text>
            </Pressable>
            {role === 'customer' && payment.status === 'paid_unverified' && !readOnly ? (
              <PrimaryButton title="Подтверждение перевода" variant="outline" onPress={() => setEvidencePayment(payment)} />
            ) : null}
          </View>
        );
      })}

      <PaymentEvidenceSheet
        visible={Boolean(evidencePayment)}
        userId={userId}
        projectId={project.id}
        payment={evidencePayment}
        onClose={() => setEvidencePayment(null)}
        onChanged={onSaved}
      />

      <BankStatementImportSheet visible={bankOpen} onClose={() => setBankOpen(false)} userId={userId} projectId={project.id} role={role} onDone={() => { setBankOpen(false); onSaved(); }} />
    </>
  );
}
