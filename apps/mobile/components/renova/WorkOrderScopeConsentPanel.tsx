/** Work scope proposal and explicit customer digest decision (online-only).
 * This is not a payment authorization/settlement UI until allocation guards
 * cover every canonical money writer. No optimistic approval and no offline queue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api, ApiError, type WorkOrder } from '@/lib/api';
import type {
  ClientScopeProposalInput, ClientScopeVersion,
} from '@/lib/api/workOrders';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportError } from '@/lib/reportError';

type Props = {
  projectId: string;
  userId: string;
  contractorId: string | null;
  role: 'customer' | 'contractor';
  workOrder: WorkOrder;
  canWrite: boolean;
  onChanged: () => void | Promise<void>;
};

function formatScopeRub(amount: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount) + ' ₽';
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function requestId(): string {
  return 'scope-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 13);
}

function apiMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Это действие доступно только непосредственному исполнителю или заказчику проекта.';
    if (error.status === 409) {
      return 'Предложение устарело, изменён исполнитель, объём, сумма или версия работы. Обновите работу и проверьте условия заново.';
    }
    if (error.status === 422) return 'Проверьте количество, цену, лимит, перечень работ и основания оплаты.';
  }
  return 'Не удалось сохранить решение. Проверьте соединение и повторите. Согласие не считается данным.';
}

function DetailLine({ title, value }: { title: string; value: string }) {
  return (
    <View style={s.detailLine}>
      <Text style={s.detailTitle}>{title}</Text>
      <Text style={s.detailText}>{value || 'Не указано'}</Text>
    </View>
  );
}

export function WorkOrderScopeConsentPanel({
  projectId, userId, contractorId, role, workOrder, canWrite, onChanged,
}: Props) {
  const [versions, setVersions] = useState<ClientScopeVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [inclusions, setInclusions] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [deliverables, setDeliverables] = useState('');
  const [risks, setRisks] = useState('');
  const [paymentMilestone, setPaymentMilestone] = useState('');
  const [disclosuresChecked, setDisclosuresChecked] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const generation = useRef(0);
  const lastRequest = useRef<{ fingerprint: string; id: string } | null>(null);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await api.listScopeVersions(userId, projectId, workOrder.id);
      if (current !== generation.current) return;
      setVersions(result.items.filter(
        (item) => item.project_id === projectId && item.work_order_id === workOrder.id,
      ));
      setError(null);
    } catch (err: unknown) {
      if (current !== generation.current) return;
      setVersions(null); // Never display a previous project's customer authorizations.
      setError('Не удалось проверить утверждённые версии. Нет данных ≠ согласовано.');
      reportError('WorkOrderScopeConsentPanel.load', err);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [userId, projectId, workOrder.id]);

  useEffect(() => {
    generation.current += 1;
    setVersions(null);
    setEdit(false);
    setDisclosuresChecked(false);
    lastRequest.current = null;
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);
  useProjectDataReload(reload);

  const proposals = versions?.filter(
    (entry) => entry.project_id === projectId && entry.work_order_id === workOrder.id,
  ) ?? [];
  const current = proposals[0] ?? null;
  const isStale = current?.snapshot.work_order.updated_at !== workOrder.updated_at;
  const canPropose = role === 'contractor' && userId === contractorId
    && canWrite && ['published', 'negotiating'].includes(workOrder.status);
  const canDecide = role === 'customer' && canWrite
    && current?.decision === 'pending'
    && !isStale && ['published', 'negotiating'].includes(workOrder.status);

  const submit = async () => {
    if (!canPropose || busy) return;
    if (!disclosuresChecked || !workOrder.assignee_id || !workOrder.updated_at
      || !workOrder.planned_start || !workOrder.planned_end
      || !quantity.trim() || !unit.trim() || !unitPrice.trim()
      || !lines(inclusions).length || !lines(deliverables).length
      || !paymentMilestone.trim()) {
      setError('Заполните объём, единицу измерения, цену, включённые и исключённые работы, результат, срок оплаты и подтвердите полноту условий.');
      return;
    }
    const details = {
      expected_updated_at: workOrder.updated_at,
      specialist_id: workOrder.assignee_id,
      quantity: quantity.trim().replace(',', '.'),
      unit: unit.trim(),
      unit_price: unitPrice.trim().replace(',', '.'),
      amount_cap: String(workOrder.budget_planned),
      inclusions: lines(inclusions),
      exclusions: lines(exclusions),
      deliverables: lines(deliverables),
      payment_milestone: paymentMilestone.trim(),
      risks: lines(risks),
    };
    const fingerprint = JSON.stringify(details);
    const id = lastRequest.current?.fingerprint === fingerprint
      ? lastRequest.current.id : requestId();
    lastRequest.current = { fingerprint, id };
    const body: ClientScopeProposalInput = { ...details, client_request_id: id };
    setBusy(true);
    setError(null);
    try {
      await api.proposeScopeVersion(userId, projectId, workOrder.id, body);
      setEdit(false);
      lastRequest.current = null;
      await reload();
      await onChanged();
    } catch (err: unknown) {
      setError(apiMessage(err));
      reportError('WorkOrderScopeConsentPanel.propose', err);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!canDecide || !current || busy) return;
    if (decision === 'rejected' && !rejectReason.trim()) {
      setError('Укажите причину отказа, чтобы исполнитель мог исправить предложение.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.decideScopeVersion(
        userId, projectId, current.id, decision, current.digest,
        decision === 'rejected' ? rejectReason.trim() : undefined,
      );
      setRejectReason('');
      await reload();
      await onChanged();
    } catch (err: unknown) {
      setError(apiMessage(err));
      reportError('WorkOrderScopeConsentPanel.decide', err);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!current || !canDecide) return;
    const t = current.snapshot.terms;
    showActionConfirm({
      title: 'Подтвердить точную версию работ?',
      message: [
        'Работа: ' + current.snapshot.work_order.title,
        'Специалист: ' + t.specialist_name,
        'Объём: ' + t.quantity + ' ' + t.unit,
        'Цена за единицу: ' + t.unit_price_rub + ' ₽',
        'Максимальная сумма: ' + t.amount_cap_rub + ' ₽',
        'Срок: ' + (current.snapshot.work_order.planned_start || '—')
          + ' — ' + (current.snapshot.work_order.planned_end || '—'),
        'Включено: ' + t.inclusions.join(', '),
        'Исключено: ' + (t.exclusions.join(', ') || 'явно не перечислено'),
        'Основание оплаты: ' + t.payment_milestone,
        'Версия ' + current.version + ', контрольный хеш ' + current.digest.slice(0, 16),
        'Это подтверждение условий, но не перевод денег.',
      ].join('\n'),
      primaryLabel: 'Подтвердить эту версию',
      onPrimary: () => { void decide('approved'); },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  return (
    <View style={s.card}>
      <Text style={s.kicker}>ЗАЩИТА ЗАКАЗЧИКА · ВЕРСИИ УСЛОВИЙ</Text>
      <Text style={s.heading}>Кто, что, когда и за сколько</Text>
      <Text style={s.note}>
        Цена и сроки в карточке не заменяют согласование точного объёма и специалиста.
        Решение сохраняется отдельно; оплата не выполняется.
      </Text>

      {loading && !versions ? <Text style={s.note}>Загружаем предложения…</Text> : null}
      {error ? <Text style={s.warning}>{error}</Text> : null}
      {!loading && versions && !current ? (
        <Text style={s.warning}>
          Подробная версия работ ещё не предложена. Согласование всей стоимости и состава исполнителей не подтверждено.
        </Text>
      ) : null}

      {current ? (
        <>
          <View style={s.meta}>
            <Text style={s.metaText}>Версия №{current.version}</Text>
            <Text style={s.metaText}>
              {current.decision === 'approved' ? 'Подтверждена заказчиком'
                : current.decision === 'rejected' ? 'Отклонена' : 'Ожидает решения'}
            </Text>
          </View>
          <DetailLine title="Специалист" value={current.snapshot.terms.specialist_name} />
          <DetailLine title="Объём" value={
            current.snapshot.terms.quantity + ' ' + current.snapshot.terms.unit
            + ' × ' + current.snapshot.terms.unit_price_rub + ' ₽'
          } />
          <DetailLine title="Максимальная согласуемая сумма" value={current.snapshot.terms.amount_cap_rub + ' ₽'} />
          <DetailLine title="Начало — завершение" value={
            (current.snapshot.work_order.planned_start || '—')
            + ' — ' + (current.snapshot.work_order.planned_end || '—')
          } />
          <DetailLine title="Включено в стоимость" value={current.snapshot.terms.inclusions.join('\n')} />
          <DetailLine title="Не включено" value={current.snapshot.terms.exclusions.join('\n') || 'Отдельных исключений не заявлено'} />
          <DetailLine title="Результат для приёмки" value={current.snapshot.terms.deliverables.join('\n')} />
          <DetailLine title="Срок и условие оплаты" value={current.snapshot.terms.payment_milestone} />
          <DetailLine title="Риски и дополнительные условия" value={current.snapshot.terms.risks.join('\n') || 'Не заявлены'} />
          <Text style={s.hash}>SHA-256: {current.digest}</Text>
          {isStale ? (
            <Text style={s.warning}>Карточка работы уже изменилась. Старую версию нельзя согласовать.</Text>
          ) : null}
          {current.decision === 'approved' ? (
            <Text style={s.warning}>
              Согласовано только это предложение. Связь с конкретными платежами и расходами пока не квалифицирована.
            </Text>
          ) : null}
          {canDecide ? (
            <View style={s.actions}>
              <PrimaryButton
                title="Согласовать эту версию"
                loading={busy}
                disabled={busy}
                onPress={confirm}
              />
              <TextInput
                accessibilityLabel="Причина отказа от условий"
                style={[s.input, s.multi]}
                placeholder="Причина отказа или требуемые уточнения"
                placeholderTextColor={RenovaTheme.colors.textSubtle}
                multiline
                value={rejectReason}
                onChangeText={setRejectReason}
              />
              <PrimaryButton
                title="Отклонить и вернуть на уточнение"
                variant="dangerOutline"
                loading={busy}
                disabled={busy || !rejectReason.trim()}
                onPress={() => { void decide('rejected'); }}
              />
            </View>
          ) : null}
        </>
      ) : null}

      {canPropose ? (
        <>
          <PrimaryButton
            title={edit ? 'Скрыть форму предложения' : 'Подготовить подробные условия для заказчика'}
            variant="outline"
            disabled={busy}
            onPress={() => setEdit((visible) => !visible)}
          />
          {edit ? (
            <View style={s.form}>
              <Text style={s.warning}>
                Специалист, стоимость и даты берутся из текущей карточки работы.
                Измените их в предложении работы до его согласования, если они неверны.
              </Text>
              <DetailLine title="Лимит по карточке" value={formatScopeRub(workOrder.budget_planned)} />
              <DetailLine title="Назначенный специалист" value={workOrder.assignee_id || 'не назначен'} />
              <DetailLine title="Дата начала — завершения" value={
                (workOrder.planned_start || '—') + ' — ' + (workOrder.planned_end || '—')
              } />
              {([
                ['Количество / объём', quantity, setQuantity, 'Например: 12.500'],
                ['Единица измерения', unit, setUnit, 'м², пог. м, шт.'],
                ['Цена за единицу (₽)', unitPrice, setUnitPrice, 'Введите точную цену без округления'],
                ['Все включённые работы (каждая с новой строки)', inclusions, setInclusions, 'Грунтовка\\nПокраска'],
                ['Все исключения из цены (каждое с новой строки)', exclusions, setExclusions, 'Демонтаж\\nВывоз мусора'],
                ['Проверяемый результат (каждый с новой строки)', deliverables, setDeliverables, 'Готовая стена\\nФотоотчёт'],
                ['Срок и основание платежа', paymentMilestone, setPaymentMilestone, 'После приёмки по акту'],
                ['Риски и условия дополнительных работ', risks, setRisks, 'Скрытые дефекты — отдельное согласование'],
              ] as const).map(([label, value, onChange, placeholder], index) => (
                <View key={label} style={s.field}>
                  <Text style={s.fieldLabel}>{label}</Text>
                  <TextInput
                    accessibilityLabel={label}
                    style={[s.input, index >= 3 ? s.multi : null]}
                    placeholder={placeholder}
                    placeholderTextColor={RenovaTheme.colors.textSubtle}
                    keyboardType={index === 0 || index === 2 ? 'decimal-pad' : 'default'}
                    multiline={index >= 3}
                    value={value}
                    onChangeText={onChange}
                  />
                </View>
              ))}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: disclosuresChecked }}
                onPress={() => setDisclosuresChecked((prev) => !prev)}
                style={s.checkbox}
              >
                <Text style={s.checkSymbol}>{disclosuresChecked ? '☑' : '☐'}</Text>
                <Text style={s.checkText}>
                  Подтверждаю, что указал все включённые и исключённые работы,
                  риски и условия дополнительных платежей. Пустое исключение означает,
                  что дополнительные исключения не заявлены.
                </Text>
              </Pressable>
              <PrimaryButton
                title="Отправить заказчику на согласование"
                loading={busy}
                disabled={busy || !disclosuresChecked}
                onPress={() => { void submit(); }}
              />
            </View>
          ) : null}
        </>
      ) : null}
      {!canPropose && role === 'contractor' && !current ? (
        <Text style={s.note}>
          Для предложения необходимы опубликованная работа, назначенный специалист,
          полная стоимость, помещение или этап и даты исполнения.
        </Text>
      ) : null}
    </View>
  );
}

const c = RenovaTheme.colors;
const s = StyleSheet.create({
  card: {
    backgroundColor: c.surface, padding: 16, gap: 12, borderRadius: RenovaTheme.radius.lg,
    borderWidth: 1, borderColor: c.border, marginTop: 16, marginBottom: 16,
  },
  kicker: { fontSize: RenovaTheme.fontSize.tiny, color: c.textMuted, fontWeight: '700', letterSpacing: 0.6 },
  heading: { fontSize: RenovaTheme.fontSize.h3, fontWeight: '700', color: c.text },
  note: { fontSize: RenovaTheme.fontSize.bodySmall, color: c.textMuted, lineHeight: 19 },
  warning: {
    color: c.warningText, fontSize: RenovaTheme.fontSize.bodySmall,
    lineHeight: 19, padding: 10, backgroundColor: c.warningBg,
    borderRadius: RenovaTheme.radius.sm,
  },
  detailLine: { gap: 3 },
  detailTitle: { fontSize: RenovaTheme.fontSize.caption, color: c.textMuted },
  detailText: { fontSize: RenovaTheme.fontSize.bodySmall, color: c.text, lineHeight: 19 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  metaText: { fontSize: RenovaTheme.fontSize.caption, color: c.accent, fontWeight: '600' },
  hash: { fontSize: RenovaTheme.fontSize.tiny, color: c.textMuted },
  actions: { gap: 10 },
  form: { gap: 12, marginTop: 6 },
  field: { gap: 4 },
  fieldLabel: { fontSize: RenovaTheme.fontSize.bodySmall, color: c.text, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: RenovaTheme.radius.sm,
    color: c.text, backgroundColor: c.surfaceMuted, minHeight: 44,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: RenovaTheme.fontSize.body,
  },
  multi: { minHeight: 78, textAlignVertical: 'top' },
  checkbox: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 44, gap: 9 },
  checkSymbol: { color: c.accent, fontSize: 20 },
  checkText: { color: c.text, fontSize: RenovaTheme.fontSize.bodySmall, flex: 1, lineHeight: 18 },
});
