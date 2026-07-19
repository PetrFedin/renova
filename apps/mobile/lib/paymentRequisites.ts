/**
 * Честные реквизиты перевода — без hardcoded demo-карт.
 * Источник: профиль исполнителя (payment_requisites) + сумма/назначение счёта.
 */
export type PaymentRequisitesSource = {
  recipientName?: string | null;
  /** Свободный текст из профиля: СБП-телефон, банк, карта… */
  paymentRequisites?: string | null;
  amount: number;
  title: string;
};

export type BuiltPaymentRequisites = {
  text: string;
  hasBankDetails: boolean;
  missingHint: string | null;
};

function formatRubPlain(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')} ₽`;
}

export function buildPaymentRequisites(src: PaymentRequisitesSource): BuiltPaymentRequisites {
  const recipient = (src.recipientName || '').trim() || 'Исполнитель по договору';
  const bank = (src.paymentRequisites || '').trim();
  const lines = [
    `Получатель: ${recipient}`,
    ...(bank ? bank.split(/\n+/).map((l) => l.trim()).filter(Boolean) : []),
    `Сумма: ${formatRubPlain(src.amount)}`,
    `Назначение: ${src.title}`,
  ];
  if (!bank) {
    return {
      text: lines.join('\n'),
      hasBankDetails: false,
      missingHint:
        'Исполнитель ещё не указал реквизиты для перевода. Попросите карту/СБП в чате или дождитесь заполнения профиля.',
    };
  }
  return { text: lines.join('\n'), hasBankDetails: true, missingHint: null };
}
