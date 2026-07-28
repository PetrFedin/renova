/** W133: create work/room, stage→acceptance, approvals, profile dates → SoT.
 * Clarity G: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import {
  calendarTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** Новая работа / задача на день */
export function alertWorkCreated(role: OsRole, workId?: string) {
  if (workId) {
    showActionConfirm({
      title: 'Работа создана',
      message: 'Появится в графике. Можно сразу открыть карточку.',
      primaryLabel: 'Открыть',
      onPrimary: () =>
        pushOsNav({ pathname: '/work-order/[id]', params: { id: workId } }, undefined, role),
      secondaryLabel: 'График',
      onSecondary: () => pushOsNav(calendarTabRoute(role), undefined, role),
    });
    return;
  }
  showActionConfirm({
    title: 'Работа создана',
    message: 'Появится в графике.',
    primaryLabel: 'График',
    onPrimary: () => pushOsNav(calendarTabRoute(role), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Новая комната на объекте */
export function alertRoomCreated(role: OsRole) {
  showActionConfirm({
    title: 'Комната добавлена',
    message: 'Дальше — план этажа или смета по комнатам.',
    primaryLabel: 'План',
    onPrimary: () => pushOsNav(objectTabRoute(role, 'plan', 'floor'), undefined, role),
    secondaryLabel: 'Смета',
    onSecondary: () => pushOsNav(objectTabRoute(role, 'estimate'), undefined, role),
  });
}

/** Исполнитель сдал этап на приёмку */
export function alertStageSubmittedForAcceptance(role: OsRole) {
  showActionConfirm({
    title: 'На приёмке',
    message: 'Заказчик получит запрос. Следите за входящими и приёмкой.',
    primaryLabel: 'Приёмка',
    onPrimary: () => pushOsNav(repairTabRoute(role, 'control'), undefined, role),
    secondaryLabel: 'Входящие',
    onSecondary: () => pushOsNav('/inbox', undefined, role),
  });
}

/** Hub согласований — после решения (не CO — CO через procurementNav) */
export function alertApprovalApproved(role: OsRole, type: string) {
  if (type === 'material') {
    showActionConfirm({
      title: 'Согласовано',
      message: 'Материал в потребностях. Можно создать закупку.',
      primaryLabel: 'К материалам',
      onPrimary: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
    return;
  }
  if (type === 'design' || type === 'room_change') {
    showActionConfirm({
      title: 'Согласовано',
      message: 'Изменение принято. Откройте объект.',
      primaryLabel: 'Объект',
      onPrimary: () => pushOsNav(objectTabRoute(role, 'plan', 'floor'), undefined, role),
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
    return;
  }
  showActionConfirm({
    title: 'Согласовано',
    message: 'Решение сохранено. Исполнитель получит уведомление.',
    primaryLabel: 'Входящие',
    onPrimary: () => pushOsNav('/inbox', undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

export function alertApprovalRejected(role: OsRole, type: string) {
  const secondary =
    type === 'material'
      ? {
          label: 'Материалы',
          go: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
        }
      : type === 'change_order'
        ? {
            label: 'Смета',
            go: () =>
              pushOsNav(
                {
                  pathname: objectTabRoute(role, 'estimate').pathname,
                  params: { ...objectTabRoute(role, 'estimate').params, estimateLayer: 'changes' },
                },
                undefined,
                role,
              ),
          }
        : {
            label: 'Входящие',
            go: () => pushOsNav('/inbox', undefined, role),
          };

  showActionConfirm({
    title: 'Отклонено',
    message: 'Исполнитель получит уведомление и сможет исправить.',
    primaryLabel: secondary.label,
    onPrimary: secondary.go,
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Профиль объекта: сроки → календарь */
export function alertProjectProfileSaved(role: OsRole, datesChanged?: boolean) {
  if (datesChanged) {
    showActionConfirm({
      title: 'Сохранено',
      message: 'Профиль обновлён. Сроки можно сверить в графике.',
      primaryLabel: 'График',
      onPrimary: () => pushOsNav(calendarTabRoute(role), undefined, role),
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
    return;
  }
  showActionConfirm({
    title: 'Сохранено',
    message: 'Профиль объекта обновлён.',
    primaryLabel: 'Понятно',
    onPrimary: () => undefined,
  });
}
