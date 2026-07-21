/** W135: portal/viewer share, floor plan upload/punch → SoT CTAs */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { openQcIssue } from '@/lib/qcNav';

/** После shareRenovaLink портала — следующие шаги в кабинете */
export function alertPortalLinkShared(role: OsRole, scopeHint: string) {
  Alert.alert(
    'Ссылка отправлена',
    `Гость откроет: ${scopeHint}. В приложении те же шаги — приёмка и оплаты.`,
    [
      { text: 'OK' },
      {
        text: 'Приёмка',
        onPress: () => pushOsNav(repairTabRoute(role, 'control'), undefined, role),
      },
      {
        text: 'Оплаты',
        onPress: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
      },
    ],
  );
}

/** Гость-viewer добавлен к объекту */
export function alertViewerGuestAdded(role: OsRole = 'customer') {
  Alert.alert(
    'Гость добавлен',
    'Доступ только на просмотр. Можно выдать портал с действиями.',
    [
      { text: 'OK' },
      {
        text: 'Объект',
        onPress: () => pushOsNav(objectTabRoute(role, 'plan'), undefined, role),
      },
    ],
  );
}

/** План этажа загружен */
export function alertFloorPlanUploaded(role: OsRole) {
  Alert.alert(
    'План загружен',
    'Отметьте замечания на плане или сверьте комнаты.',
    [
      { text: 'OK' },
      {
        text: 'План',
        onPress: () => pushOsNav(objectTabRoute(role, 'plan'), undefined, role),
      },
      {
        text: 'Комнаты',
        onPress: () => pushOsNav(objectTabRoute(role, 'rooms'), undefined, role),
      },
    ],
  );
}

/** Punch на плане — уже уходим в QC; CTA назад на план */
export function alertFloorPunchCreated(
  role: OsRole,
  opts: { hasPhoto: boolean; issueId?: string; returnTo?: string },
) {
  Alert.alert(
    'Замечание в QC',
    opts.hasPhoto
      ? 'Сохранено с фото на плане — открыт Контроль качества.'
      : 'Сохранено в Контроле качества — дополните описание.',
    [
      { text: 'OK' },
      {
        text: 'План',
        onPress: () => pushOsNav(objectTabRoute(role, 'plan'), opts.returnTo, role),
      },
      ...(opts.issueId
        ? [
            {
              text: 'К замечанию',
              onPress: () => openQcIssue(opts.issueId, opts.returnTo, role),
            },
          ]
        : []),
    ],
  );
}
