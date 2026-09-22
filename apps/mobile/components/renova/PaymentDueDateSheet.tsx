/** Срок оплаты счёта — ввод даты и быстрые пресеты; он же задаёт очерёдность. */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { api, type Payment } from '@/lib/api';
import { formatDueDate, parseDueDateInput } from '@/lib/domain/paymentDueDate';
import { apiErrorMessage } from '@/lib/formatPhone';

const DUE_PRESETS = [
  { label: 'Сегодня', days: 0 },
  { label: 'Завтра', days: 1 },
  { label: 'Через 3 дня', days: 3 },
  { label: 'Через неделю', days: 7 },
];

function presetInput(days: number): string {
  const date = new Date(Date.now() + days * 86400000);
  const day = `${date.getDate()}`.padStart(2, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

function stopPropagation(event: unknown): void {
  if (typeof event !== 'object' || event === null || !('stopPropagation' in event)) return;
  const stop = event.stopPropagation;
  if (typeof stop === 'function') stop.call(event);
}

export function PaymentDueDateSheet({
  visible,
  userId,
  projectId,
  payment,
  onClose,
  onChanged,
}: {
  visible: boolean;
  userId: string;
  projectId: string;
  payment: Payment | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setInput(formatDueDate(payment?.due_at));
  }, [visible, payment?.due_at]);

  const save = async (raw: string) => {
    if (!payment || busy) return;
    const parsed = parseDueDateInput(raw);
    if (!parsed.ok) {
      showActionConfirm({ title: 'Срок оплаты', message: parsed.message });
      return;
    }
    setBusy(true);
    try {
      await api.setPaymentDueDate(userId, projectId, payment.id, parsed.iso);
      onChanged();
      onClose();
    } catch (error: unknown) {
      showActionConfirm({
        title: 'Не удалось сохранить срок',
        message: apiErrorMessage(error, 'Попробуйте ещё раз.'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={stopPropagation}>
          <Text style={s.head}>Оплатить до</Text>
          <Text style={s.hint}>
            Счета со сроком идут в списке первыми — ближайший сверху. Пустое поле убирает срок.
          </Text>
          <TextInput
            style={s.inp}
            value={input}
            onChangeText={setInput}
            placeholder="ДД.ММ.ГГГГ"
            keyboardType="numbers-and-punctuation"
            editable={!busy}
            accessibilityLabel="Срок оплаты счёта"
          />
          <View style={s.row}>
            {DUE_PRESETS.map((preset) => (
              <PrimaryButton
                key={preset.days}
                title={preset.label}
                compact
                variant="outline"
                disabled={busy}
                onPress={() => setInput(presetInput(preset.days))}
              />
            ))}
          </View>
          <PrimaryButton
            title={busy ? 'Сохранение…' : 'Сохранить срок'}
            onPress={() => { void save(input); }}
            disabled={busy}
            fullWidth
          />
          {payment?.due_at ? (
            <PrimaryButton
              title="Убрать срок"
              variant="ghost"
              disabled={busy}
              onPress={() => { void save(''); }}
              fullWidth
            />
          ) : null}
          <PrimaryButton title="Отмена" variant="outline" onPress={onClose} disabled={busy} fullWidth />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: RenovaTheme.radius.xl,
    borderTopRightRadius: RenovaTheme.radius.xl,
    padding: RenovaTheme.spacing.md,
    paddingBottom: RenovaTheme.spacing.xl,
    gap: RenovaTheme.spacing.sm,
  },
  head: { ...screenTypography.section, marginTop: 0 },
  hint: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  inp: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.borderLight,
    borderRadius: RenovaTheme.radius.md,
    padding: RenovaTheme.spacing.sm,
    minHeight: RenovaTheme.minTouch,
    fontSize: RenovaTheme.fontSize.body,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.xs },
});
