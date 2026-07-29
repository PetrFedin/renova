/** Создание счёта на оплату — исполнитель в «Бюджет → Оплаты» */
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { StagePickerChips } from '@/components/renova/StagePickerChips';
import { formSurfaceStyles } from '@/constants/formStyles';
import { filterChipStyles } from '@/constants/screenTypography';
import { api, type ProjectDetail } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { alertPaymentCreated } from '@/lib/estimatePayNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { apiErrorMessage } from '@/lib/formatPhone';
import type { OsRole } from '@/constants/osSections';
import { OFFLINE_MESSAGES, OFFLINE_PAYMENT_CREATE_BLOCKED } from '@/lib/offlineErrors';
import { reportCatch } from '@/lib/reportError';
import { createClientRequestId } from '@/lib/clientRequestId';

/** Backend: contractor может создавать только stage/material (payments.py). */
const PAY_TYPES = [
  { id: 'stage', label: 'Этап' },
  { id: 'material', label: 'Материалы' },
] as const;

const STAGE_PERCENTS = [30, 50, 70, 100] as const;

type PaymentTypeId = (typeof PAY_TYPES)[number]['id'];

export function CreatePaymentForm({
  userId,
  project,
  onSaved,
  onCancel,
}: {
  userId: string;
  project: ProjectDetail;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const { user } = useRenova();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentTypeId>('stage');
  const [stageId, setStageId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestIdRef = useRef(createClientRequestId('payment'));
  const [percent, setPercent] = useState<number | null>(null);

  const clearDraft = () => {
    setTitle('');
    setAmount('');
    setNotes('');
    setPercent(null);
    setStageId(null);
  };

  const submit = async () => {
    if (busyRef.current) return;
    const normalizedAmount = Number.parseFloat(amount.replace(',', '.'));
    if (!title.trim() && !(paymentType === 'stage' && percent)) {
      showActionConfirm({ title: 'Название счёта', message: 'Укажите, за что выставлен счёт.' });
      return;
    }
    if (paymentType === 'stage' && !stageId) {
      showActionConfirm({ title: 'Выберите этап', message: 'Счёт за этап должен быть привязан к этапу проекта.' });
      return;
    }
    if (percent == null && (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0)) {
      showActionConfirm({ title: 'Сумма счёта', message: 'Укажите положительную сумму или выберите долю этапа.' });
      return;
    }

    const stage = project.stages?.find((item) => item.id === stageId);
    busyRef.current = true;
    setBusy(true);
    let created = false;
    try {
      await api.createPayment(userId, project.id, {
        title: title.trim() || (stage && percent ? `${stage.name}: ${percent}%` : 'Оплата этапа'),
        amount: percent != null ? undefined : normalizedAmount,
        percent: percent ?? undefined,
        payment_type: paymentType,
        stage_id: paymentType === 'stage' ? stageId : null,
        notes: notes.trim() || null,
        client_request_id: requestIdRef.current,
      });
      created = true;
    } catch (error: unknown) {
      const offlineBlocked = error instanceof Error && error.message === OFFLINE_PAYMENT_CREATE_BLOCKED;
      const message = offlineBlocked
        ? OFFLINE_MESSAGES[OFFLINE_PAYMENT_CREATE_BLOCKED]
        : apiErrorMessage(error, 'Не удалось создать счёт');
      showActionConfirm({
        title: 'Не удалось создать счёт',
        message: message.includes('403') || message.includes('Forbidden')
          ? 'Этот тип счёта недоступен исполнителю. Используйте «Этап» или «Материалы».'
          : `${message} Введённые данные сохранены в форме.`,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }

    if (!created) return;
    requestIdRef.current = createClientRequestId('payment');
    clearDraft();
    onSaved?.();
    alertPaymentCreated((user?.role === 'customer' ? 'customer' : 'contractor') as OsRole);
    void syncProjectSideEffects({ user: user ?? ({ id: userId } as never), project })
      .catch(reportCatch('CreatePaymentForm.sideEffects'));
  };

  const selectPaymentType = (next: PaymentTypeId) => {
    if (busyRef.current) return;
    setPaymentType(next);
    if (next !== 'stage') {
      setPercent(null);
      setStageId(null);
    }
  };

  return (
    <View style={formSurfaceStyles.container}>
      <Text style={formSurfaceStyles.title}>Новый счёт</Text>
      <Text style={formSurfaceStyles.hint}>Выставьте счёт за этап или материалы. Для этапа можно выбрать долю от его стоимости.</Text>

      <Text style={formSurfaceStyles.label}>Тип счёта</Text>
      <View style={filterChipStyles.row}>
        {PAY_TYPES.map((type) => {
          const selected = paymentType === type.id;
          return (
            <Pressable
              key={type.id}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: busy }}
              accessibilityLabel={`Тип счёта: ${type.label}`}
              style={[filterChipStyles.chip, formSurfaceStyles.chipTouch, selected && filterChipStyles.chipOn]}
              disabled={busy}
              onPress={() => selectPaymentType(type.id)}
            >
              <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{type.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={formSurfaceStyles.label}>Название</Text>
      <TextInput
        style={formSurfaceStyles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Например: Штукатурка"
        editable={!busy}
        accessibilityLabel="Название счёта"
      />

      {paymentType === 'stage' ? (
        <>
          {project.stages?.length ? (
            <StagePickerChips
              stages={project.stages}
              value={stageId}
              onChange={setStageId}
              optional={false}
              disabled={busy}
              label="Этап"
            />
          ) : (
            <Text style={formSurfaceStyles.hint}>Сначала добавьте этап проекта.</Text>
          )}
          <Text style={formSurfaceStyles.label}>Доля этапа</Text>
          <View style={filterChipStyles.row}>
            {STAGE_PERCENTS.map((value) => {
              const selected = percent === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: busy }}
                  accessibilityLabel={`${value} процентов от этапа`}
                  style={[filterChipStyles.chip, formSurfaceStyles.chipTouch, selected && filterChipStyles.chipOn]}
                  disabled={busy}
                  onPress={() => { setPercent(value); setAmount(''); }}
                >
                  <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{value}%</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <Text style={formSurfaceStyles.label}>{percent != null ? 'Сумма рассчитывается автоматически' : 'Сумма'}</Text>
      <TextInput
        style={formSurfaceStyles.input}
        value={amount}
        onChangeText={(value) => { setAmount(value); setPercent(null); }}
        placeholder={percent != null ? `${percent}% от стоимости этапа` : 'Сумма, ₽'}
        keyboardType="decimal-pad"
        editable={!busy && percent == null}
        accessibilityLabel="Сумма счёта"
      />

      <Text style={formSurfaceStyles.label}>Комментарий</Text>
      <TextInput
        style={[formSurfaceStyles.input, formSurfaceStyles.multilineInput]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Необязательно"
        editable={!busy}
        multiline
        accessibilityLabel="Комментарий к счёту"
      />
      <View style={formSurfaceStyles.actionStack}>
        <PrimaryButton
          title="Выставить счёт"
          onPress={() => { void submit(); }}
          loading={busy}
          disabled={busy}
          fullWidth
        />
        {onCancel ? (
          <PrimaryButton title="Отмена" variant="ghost" onPress={onCancel} disabled={busy} fullWidth />
        ) : null}
      </View>
    </View>
  );
}
