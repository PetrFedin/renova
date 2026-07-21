/** W129: чек ФНС/скан → расходы / материалы / оплаты SoT (Smetter/Gectaro RU) */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, repairTabRoute, type OsRole } from '@/constants/osSections';

export type ReceiptScanInfo = {
  verified: boolean;
  message: string;
  amount: number;
  paymentId?: string | null;
};

/** После scan QR — не тупик на OK/back */
export function alertReceiptScanned(role: OsRole, info: ReceiptScanInfo, onDone?: () => void) {
  const title = info.verified ? 'Чек принят' : 'Чек сохранён';
  const body = `${info.message}\nСумма: ${info.amount.toLocaleString('ru-RU')} ₽`;
  const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [
    {
      text: 'Готово',
      style: 'cancel',
      onPress: () => onDone?.(),
    },
    {
      text: 'Расходы',
      onPress: () => {
        onDone?.();
        pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role);
      },
    },
    {
      text: 'Чеки / материалы',
      onPress: () => {
        onDone?.();
        pushOsNav(repairTabRoute(role, 'materials'), undefined, role);
      },
    },
  ];
  if (info.paymentId) {
    buttons.push({
      text: 'К оплатам',
      onPress: () => {
        onDone?.();
        pushOsNav(budgetTabRoute(role, 'payments'), undefined, role);
      },
    });
  }
  Alert.alert(title, body, buttons);
}

/** Повторная проверка ФНС из списка */
export function alertReceiptReverified(
  role: OsRole,
  res: { verified?: boolean; message?: string; verify_mode?: string },
) {
  const msg =
    `${res.message || (res.verified ? 'Подтверждён' : 'Не подтверждён')}` +
    (res.verify_mode ? ` · режим: ${res.verify_mode}` : '');
  Alert.alert(res.verified ? 'ФНС: ок' : 'ФНС', msg, [
    { text: 'OK' },
    {
      text: 'Расходы',
      onPress: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
    },
  ]);
}

/** Ручной расход без QR */
export function alertManualExpenseSaved(role: OsRole, amount: number) {
  Alert.alert(
    'Сохранено',
    `${amount.toLocaleString('ru-RU')} ₽ добавлено в расходы`,
    [
      { text: 'OK' },
      {
        text: 'Открыть расходы',
        onPress: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
      },
    ],
  );
}

/** W134: массовая привязка чеков к этапу */
export function alertReceiptsBulkLinked(role: OsRole, count: number) {
  Alert.alert(
    'Чеки привязаны',
    `Привязано: ${count}. Сверьте fact в расходах и на этапе.`,
    [
      { text: 'OK' },
      {
        text: 'Расходы',
        onPress: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
      },
      {
        text: 'Материалы',
        onPress: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
      },
    ],
  );
}

/** W134: массовая категория чеков */
export function alertReceiptsBulkCategorized(role: OsRole, label: string, count: number) {
  Alert.alert(
    'Категория обновлена',
    `«${label}» — ${count} чек(ов).`,
    [
      { text: 'OK' },
      {
        text: 'Расходы',
        onPress: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
      },
    ],
  );
}
