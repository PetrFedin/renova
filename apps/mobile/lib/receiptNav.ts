/** W129: чек ФНС/скан → расходы / материалы / оплаты SoT (Smetter/Gectaro RU).
 * Clarity I: sheet вместо Alert. Honesty: demo/off не masquerade as live ФНС. */
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, repairTabRoute, type OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

export type ReceiptScanInfo = {
  verified: boolean;
  message: string;
  amount: number;
  paymentId?: string | null;
  /** live | demo | off — не маскируем stub как налоговую правду */
  verify_mode?: string;
};

/** После scan QR — не тупик на OK/back */
export function alertReceiptScanned(role: OsRole, info: ReceiptScanInfo, onDone?: () => void) {
  const mode = info.verify_mode || '';
  const demoish = mode === 'demo' || mode === 'off';
  const title = info.verified
    ? demoish
      ? 'Чек принят (demo ФНС)'
      : 'Чек принят'
    : 'Чек сохранён';
  const modeHint = mode ? `\nПроверка: ${mode}${demoish ? ' — не налоговая правда' : ''}` : '';
  const body = `${info.message}\nСумма: ${info.amount.toLocaleString('ru-RU')} ₽${modeHint}`;

  if (info.paymentId) {
    showActionConfirm({
      title,
      message: body,
      primaryLabel: 'К оплатам',
      onPrimary: () => {
        onDone?.();
        pushOsNav(budgetTabRoute(role, 'payments'), undefined, role);
      },
      secondaryLabel: 'Расходы',
      onSecondary: () => {
        onDone?.();
        pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role);
      },
    });
    return;
  }

  showActionConfirm({
    title,
    message: body,
    primaryLabel: 'Расходы',
    onPrimary: () => {
      onDone?.();
      pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role);
    },
    secondaryLabel: 'Чеки / материалы',
    onSecondary: () => {
      onDone?.();
      pushOsNav(repairTabRoute(role, 'materials'), undefined, role);
    },
  });
}

/** Повторная проверка ФНС из списка */
export function alertReceiptReverified(
  role: OsRole,
  res: { verified?: boolean; message?: string; verify_mode?: string },
) {
  const msg =
    `${res.message || (res.verified ? 'Подтверждён' : 'Не подтверждён')}` +
    (res.verify_mode ? ` · режим: ${res.verify_mode}` : '');
  showActionConfirm({
    title: res.verified ? 'ФНС: ок' : 'ФНС',
    message: msg,
    primaryLabel: 'Расходы',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Ручной расход без QR */
export function alertManualExpenseSaved(role: OsRole, amount: number) {
  showActionConfirm({
    title: 'Сохранено',
    message: `${amount.toLocaleString('ru-RU')} ₽ добавлено в расходы`,
    primaryLabel: 'Открыть расходы',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** W134: массовая привязка чеков к этапу */
export function alertReceiptsBulkLinked(role: OsRole, count: number) {
  showActionConfirm({
    title: 'Чеки привязаны',
    message: `Привязано: ${count}. Сверьте fact в расходах и на этапе.`,
    primaryLabel: 'Расходы',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
    secondaryLabel: 'Материалы',
    onSecondary: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
  });
}

/** W134: массовая категория чеков */
export function alertReceiptsBulkCategorized(role: OsRole, label: string, count: number) {
  showActionConfirm({
    title: 'Категория обновлена',
    message: `«${label}» — ${count} чек(ов).`,
    primaryLabel: 'Расходы',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}
