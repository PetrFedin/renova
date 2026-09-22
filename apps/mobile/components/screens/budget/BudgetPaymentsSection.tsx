/** Вкладка «Бюджет → Оплаты» — создание, фильтры, история */
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import { filterChipStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { CreatePaymentForm } from '@/components/renova/CreatePaymentForm';
import { BankStatementImportSheet } from '@/components/renova/BankStatementImportSheet';
import { PaymentEvidenceSheet } from '@/components/renova/PaymentEvidenceSheet';
import { PaymentDueDateSheet } from '@/components/renova/PaymentDueDateSheet';
import { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL } from '@/constants/labels';
import type { Payment, ProjectDetail } from '@/lib/api';
import type { PaymentFilter } from '@/lib/hooks/useOsBudgetScreen';
import type { OsRole } from '@/constants/osSections';
import { budgetScreenStyles as s } from '@/components/screens/budget/budgetScreenStyles';
import { dueDateLabel, dueDateState, sortPaymentsByDue } from '@/lib/domain/paymentDueDate';

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
  role,
  userId,
  project,
  readOnly,
  canWrite,
  payFilter,
  setPayFilter,
  filteredPayments,
  onPaymentPress,
  onSaved,
}: Props) {
  const [bankOpen, setBankOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [evidencePayment, setEvidencePayment] = useState<Payment | null>(null);
  const [duePayment, setDuePayment] = useState<Payment | null>(null);
  const canOperate = canWrite && !readOnly;
  // Очерёдность выводится из срока оплаты, поэтому сортируем прямо перед выводом.
  const orderedPayments = sortPaymentsByDue(filteredPayments);
  const canCreate = role === 'contractor' && canOperate;

  const handleSaved = () => {
    setCreateOpen(false);
    onSaved();
  };

  return (
    <>
      <Text style={s.dataHint}>
        Счета — оплата работ или материалов исполнителю. После ручного перевода
        приложите подтверждение: в подтверждённый расход сумма попадёт только после проверки.
      </Text>

      {canOperate ? (
        <View style={s.actions}>
          {canCreate ? (
            <PrimaryButton
              title={createOpen ? 'Скрыть форму' : 'Выставить счёт'}
              variant={createOpen ? 'outline' : 'primary'}
              onPress={() => setCreateOpen((value) => !value)}
            />
          ) : null}
          <PrimaryButton
            title="Импорт выписки"
            variant="outline"
            onPress={() => setBankOpen(true)}
          />
        </View>
      ) : null}

      {canCreate && createOpen ? (
        <CreatePaymentForm
          userId={userId}
          project={project}
          onSaved={handleSaved}
          onCancel={() => setCreateOpen(false)}
        />
      ) : null}

      <Text style={s.section}>Счета и история</Text>
      <View style={filterChipStyles.row}>
        {PAYMENT_FILTERS.map((filter) => {
          const selected = payFilter === filter.id;
          return (
            <Pressable
              key={filter.id}
              accessibilityRole="button"
              accessibilityLabel={`Фильтр оплат: ${filter.label}`}
              accessibilityState={{ selected }}
              style={[
                filterChipStyles.chip,
                { minHeight: RenovaTheme.minTouch, justifyContent: 'center' },
                selected && filterChipStyles.chipOn,
              ]}
              onPress={() => setPayFilter(filter.id)}
            >
              <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!filteredPayments.length ? (
        <View style={{ paddingVertical: RenovaTheme.spacing.lg }}>
          <Text style={s.empty}>{emptyLabel(payFilter)}</Text>
          {payFilter !== 'all' ? (
            <PrimaryButton
              title="Показать все счета"
              variant="ghost"
              onPress={() => setPayFilter('all')}
            />
          ) : null}
        </View>
      ) : null}

      {orderedPayments.map((payment) => {
        const confirmedDate = formatConfirmedDate(payment.confirmed_at);
        const statusColor = payment.status === 'pending' || payment.status === 'paid_unverified'
          ? RenovaTheme.colors.warning
          : payment.status === 'confirmed'
            ? RenovaTheme.colors.success
            : RenovaTheme.colors.textMuted;
        const stage = payment.stage_id
          ? (project.stages || []).find((candidate) => candidate.id === payment.stage_id)
          : null;
        const stageAllowsPaymentEvidence = payment.payment_type !== 'stage'
          || Boolean(stage?.customer_accepted_at);
        const canAttachEvidence = role === 'customer'
          && canOperate
          && stageAllowsPaymentEvidence
          && (payment.status === 'pending' || payment.status === 'paid_unverified');
        const evidenceTitle = payment.status === 'pending'
          ? 'Я перевёл — приложить подтверждение'
          : 'Подтверждение перевода';
        const dueState = dueDateState(payment.due_at);
        const dueLabel = dueDateLabel(payment.due_at);
        const dueColor = dueState === 'overdue'
          ? RenovaTheme.colors.danger
          : dueState === 'today' || dueState === 'soon'
            ? RenovaTheme.colors.warning
            : RenovaTheme.colors.textMuted;
        const canSetDue = canOperate && payment.status === 'pending';

        return (
          <View key={payment.id}>
            <Pressable
              style={s.row}
              accessibilityRole="button"
              accessibilityLabel={`Открыть счёт ${payment.title}, ${formatRub(payment.amount)}`}
              onPress={() => onPaymentPress(payment)}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{payment.title}</Text>
                <Text style={s.rowMeta}>
                  {PAYMENT_TYPE_LABEL[payment.payment_type] || payment.payment_type} · {formatRub(payment.amount)}
                  {confirmedDate ? ` · ${confirmedDate}` : ''}
                </Text>
                {dueLabel ? (
                  <Text style={[s.rowMeta, { color: dueColor, fontWeight: dueState === 'overdue' ? '700' : '600' }]}>
                    {dueLabel}
                  </Text>
                ) : null}
              </View>
              <Text style={[s.status, { color: statusColor }]}>
                {PAYMENT_STATUS_LABEL[payment.status] || payment.status}
              </Text>
            </Pressable>
            {canSetDue ? (
              <PrimaryButton
                title={payment.due_at ? `Срок: ${dueLabel}` : 'Указать срок оплаты'}
                variant="ghost"
                onPress={() => setDuePayment(payment)}
                fullWidth
              />
            ) : null}
            {canAttachEvidence ? (
              <PrimaryButton
                title={evidenceTitle}
                variant="outline"
                onPress={() => setEvidencePayment(payment)}
                fullWidth
              />
            ) : null}
          </View>
        );
      })}

      <PaymentDueDateSheet
        visible={Boolean(duePayment)}
        userId={userId}
        projectId={project.id}
        payment={duePayment}
        onClose={() => setDuePayment(null)}
        onChanged={onSaved}
      />

      <PaymentEvidenceSheet
        visible={Boolean(evidencePayment)}
        userId={userId}
        projectId={project.id}
        payment={evidencePayment}
        onClose={() => setEvidencePayment(null)}
        onChanged={onSaved}
      />

      <BankStatementImportSheet
        visible={bankOpen}
        onClose={() => setBankOpen(false)}
        userId={userId}
        projectId={project.id}
        role={role}
        onDone={() => {
          setBankOpen(false);
          onSaved();
        }}
      />
    </>
  );
}