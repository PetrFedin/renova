import type { UserRole } from '@/lib/api';

/**
 * ROLE-011: лимит 402 «нужен Pro» относится к тарифу исполнителя. Заказчик
 * купить Pro не может (start-trial/checkout → 403), поэтому ему показываем
 * объяснение без кнопки покупки.
 */
export function canPurchasePro(role: UserRole | null | undefined): boolean {
  return role === 'contractor';
}

export const CUSTOMER_PRO_LIMIT_NOTICE = {
  title: 'Лимит бесплатного тарифа исполнителя',
  message:
    'У исполнителя исчерпан лимит бесплатного тарифа. Подписку Pro оформляет сам исполнитель — ' +
    'попросите его перейти на Pro или выберите другого исполнителя.',
} as const;
