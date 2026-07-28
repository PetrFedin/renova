/** W135: portal/viewer share, floor plan upload/punch → SoT CTAs.
 * Clarity H: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  objectTabRoute,
  planPunchRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { openQcIssue } from '@/lib/qcNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** После shareRenovaLink портала — следующие шаги в кабинете */
export function alertPortalLinkShared(role: OsRole, scopeHint: string) {
  showActionConfirm({
    title: 'Ссылка отправлена',
    message: `Гость откроет: ${scopeHint}. В приложении те же шаги — приёмка и оплаты.`,
    primaryLabel: 'Приёмка',
    onPrimary: () => pushOsNav(repairTabRoute(role, 'control'), undefined, role),
    secondaryLabel: 'Оплаты',
    onSecondary: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
  });
}

/** Гость-viewer добавлен к объекту */
export function alertViewerGuestAdded(role: OsRole = 'customer') {
  showActionConfirm({
    title: 'Гость добавлен',
    message: 'Доступ только на просмотр. Можно выдать портал с действиями.',
    primaryLabel: 'Объект',
    onPrimary: () => pushOsNav(objectTabRoute(role, 'plan'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** План этажа загружен */
export function alertFloorPlanUploaded(role: OsRole) {
  showActionConfirm({
    title: 'План загружен',
    message: 'Отметьте замечания на плане или сверьте комнаты.',
    primaryLabel: 'Замечания',
    onPrimary: () => pushOsNav(planPunchRoute(role), undefined, role),
    secondaryLabel: 'Комнаты',
    onSecondary: () => pushOsNav(objectTabRoute(role, 'rooms'), undefined, role),
  });
}

/** Punch на плане — уже уходим в QC; CTA назад на план (слой floor) */
export function alertFloorPunchCreated(
  role: OsRole,
  opts: { hasPhoto: boolean; issueId?: string; returnTo?: string },
) {
  if (opts.issueId) {
    showActionConfirm({
      title: 'Замечание в QC',
      message: opts.hasPhoto
        ? 'Сохранено с фото на плане — открыт Контроль качества.'
        : 'Сохранено в Контроле качества — дополните описание.',
      primaryLabel: 'К замечанию',
      onPrimary: () => openQcIssue(opts.issueId, opts.returnTo, role),
      secondaryLabel: 'План',
      onSecondary: () => pushOsNav(objectTabRoute(role, 'plan', 'floor'), opts.returnTo, role),
    });
    return;
  }
  showActionConfirm({
    title: 'Замечание в QC',
    message: opts.hasPhoto
      ? 'Сохранено с фото на плане — открыт Контроль качества.'
      : 'Сохранено в Контроле качества — дополните описание.',
    primaryLabel: 'План',
    onPrimary: () => pushOsNav(objectTabRoute(role, 'plan', 'floor'), opts.returnTo, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}
