import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RenovaTheme } from '@/constants/Theme';
import type { ResponsibilityQueue } from '@/lib/api';

const PERSONA_LABEL: Record<string, string> = {
  owner: 'Владелец',
  lead: 'Ведущий исполнитель',
};

const ACTION_LABEL: Record<string, string> = {
  pay_invoice: 'Оплатить счёт',
  confirm_payment_received: 'Подтвердить получение денег',
};

export function BudgetResponsibilityStrip({
  queue,
  userId,
  onOpenPayments,
}: {
  queue: ResponsibilityQueue | null;
  userId: string;
  onOpenPayments: () => void;
}) {
  const item = queue?.items?.find((candidate) => candidate.resource_type === 'payment');
  if (!item) return null;

  const mine = item.responsible_user_id === userId;
  const actor = PERSONA_LABEL[item.responsible_persona] || item.responsible_persona;
  const next = item.next ? (PERSONA_LABEL[item.next.persona] || item.next.persona) : null;

  return (
    <Pressable accessibilityRole="button" onPress={onOpenPayments} style={s.wrap}>
      <View style={s.copy}>
        <Text style={s.kicker}>{mine ? 'ДЕНЬГИ · МОЁ ДЕЙСТВИЕ' : 'ДЕНЬГИ · ЖДУ ДРУГОГО'}</Text>
        <Text style={s.title}>{ACTION_LABEL[item.action] || item.action}</Text>
        <Text numberOfLines={1} style={s.meta}>
          {mine ? item.resource_title : actor + ': ' + item.resource_title}
        </Text>
        {item.current_state === 'paid_unverified' ? (
          <Text style={s.next}>Перевод отмечен, но ещё не вошёл в финансовый факт.</Text>
        ) : next ? (
          <Text style={s.next}>После оплаты: {next}</Text>
        ) : null}
      </View>
      <Text style={s.arrow}>→</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.md,
    backgroundColor: RenovaTheme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: { flex: 1 },
  kicker: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  title: {
    marginTop: 2,
    fontSize: RenovaTheme.fontSize.body,
    color: RenovaTheme.colors.text,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  meta: {
    marginTop: 2,
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
  },
  next: {
    marginTop: 2,
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
  },
  arrow: {
    fontSize: RenovaTheme.fontSize.h3,
    color: RenovaTheme.colors.primary,
  },
});
