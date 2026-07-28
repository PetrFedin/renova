/** Создание счёта на оплату — исполнитель в «Бюджет → Оплаты» */
import { useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, filterChipStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { StagePickerChips } from '@/components/renova/StagePickerChips';
import { api, type ProjectDetail } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { alertPaymentCreated } from '@/lib/estimatePayNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { apiErrorMessage } from '@/lib/formatPhone';
import type { OsRole } from '@/constants/osSections';

/** Backend: contractor может создавать только stage/material (payments.py). */
const PAY_TYPES = [
  { id: 'stage', label: 'Этап' },
  { id: 'material', label: 'Материалы' },
] as const;

const STAGE_PERCENTS = [30, 50, 70, 100] as const;

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
  const [paymentType, setPaymentType] = useState<(typeof PAY_TYPES)[number]['id']>('stage');
  const [stageId, setStageId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [percent, setPercent] = useState<number | null>(null);

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

    busyRef.current = true;
    setBusy(true);
    try {
      const stage = project.stages?.find((item) => item.id === stageId);
      await api.createPayment(userId, project.id, {
        title: title.trim() || (stage && percent ? `${stage.name}: ${percent}%` : 'Оплата этапа'),
        amount: percent != null ? undefined : normalizedAmount,
        percent: percent ?? undefined,
        payment_type: paymentType,
        stage_id: stageId,
        notes: notes.trim() || null,
      });
      await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project });
      setTitle('');
      setAmount('');
      setNotes('');
      setPercent(null);
      setStageId(null);
      onSaved?.();
      alertPaymentCreated((user?.role === 'customer' ? 'customer' : 'contractor') as OsRole);
    } catch (error: unknown) {
      const message = apiErrorMessage(error, 'Не удалось создать счёт');
      showActionConfirm({
        title: 'Не удалось создать счёт',
        message: message.includes('403') || message.includes('Forbidden')
          ? 'Этот тип счёта недоступен исполнителю. Используйте «Этап» или «Материалы».'
          : `${message}. Введённые данные сохранены в форме.`,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const selectPaymentType = (next: (typeof PAY_TYPES)[number]['id']) => {
    if (busy) return;
    setPaymentType(next);
    if (next !== 'stage') setPercent(null);
  };

  return (
    <View style={s.box}>
      <Text style={s.head}>Новый счёт</Text>
      <Text style={s.hint}>Выставьте счёт за этап или материалы. Для этапа можно выбрать долю от его стоимости.</Text>

      <Text style={s.label}>Тип счёта</Text>
      <View style={filterChipStyles.row}>
        {PAY_TYPES.map((type) => {
          const selected = paymentType === type.id;
          return (
            <Pressable
              key={type.id}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: busy }}
              accessibilityLabel={`Тип счёта: ${type.label}`}
              style={[filterChipStyles.chip, s.chipTouch, selected && filterChipStyles.chipOn]}
              disabled={busy}
              onPress={() => selectPaymentType(type.id)}
            >
              <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{type.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={s.label}>Название</Text>
      <TextInput
        style={s.inp}
        value={title}
        onChangeText={setTitle}
        placeholder="Например: Штукатурка"
        editable={!busy}
      />

      {paymentType === 'stage' ? (
        <>
          <Text style={s.label}>Этап</Text>
          {project.stages?.length ? (
            <StagePickerChips stages={project.stages} value={stageId} onChange={setStageId} />
          ) : (
            <Text style={s.hint}>Сначала добавьте этап проекта.</Text>
          )}
          <Text style={s.label}>Доля этапа</Text>
          <View style={filterChipStyles.row}>
            {STAGE_PERCENTS.map((value) => {
              const selected = percent === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: busy }}
                  accessibilityLabel={`${value} процентов от этапа`}
                  style={[filterChipStyles.chip, s.chipTouch, selected && filterChipStyles.chipOn]}
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

      <Text style={s.label}>{percent != null ? 'Сумма рассчитывается автоматически' : 'Сумма'}</Text>
      <TextInput
        style={s.inp}
        value={amount}
        onChangeText={(value: string) => { setAmount(value); setPercent(null); }}
        placeholder={percent != null ? `${percent}% от стоимости этапа` : 'Сумма, ₽'}
        keyboardType="decimal-pad"
        editable={!busy && percent == null}
      />

      <Text style={s.label}>Комментарий</Text>
      <TextInput
        style={s.inp}
        value={notes}
        onChangeText={setNotes}
        placeholder="Необязательно"
        editable={!busy}
      />
      <PrimaryButton
        title="Выставить счёт"
        onPress={() => { void submit(); }}
        loading={busy}
        disabled={busy}
        fullWidth
      />
      {onCancel ? (
        <PrimaryButton
          title="Отмена"
          variant="ghost"
          onPress={onCancel}
          disabled={busy}
          fullWidth
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    gap: 8,
    marginBottom: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
  },
  head: { ...screenTypography.listTitle, fontSize: 16 },
  hint: { ...screenTypography.listMeta, marginBottom: 4 },
  label: { ...screenTypography.section, marginTop: 6, marginBottom: 2 },
  chipTouch: { minHeight: RenovaTheme.minTouch, justifyContent: 'center' },
  inp: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: RenovaTheme.minTouch,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.surface,
  },
});
