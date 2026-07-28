/** W136: room change, archive, waste lifecycle, expense edit → SoT.
 * Clarity H: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** Заказчик запросил изменение комнаты */
export function alertRoomChangeRequested(role: OsRole = 'customer') {
  showActionConfirm({
    title: 'Запрос отправлен',
    message: 'Исполнитель согласует изменение. Следите во «Входящих» и в комнатах.',
    primaryLabel: 'Входящие',
    onPrimary: () => pushOsNav('/inbox', undefined, role),
    secondaryLabel: 'Согласования',
    onSecondary: () => pushOsNav('/approvals', undefined, role),
  });
}

/** Комната в архиве */
export function alertRoomArchived(role: OsRole, roomName: string) {
  showActionConfirm({
    title: 'В архиве',
    message: `«${roomName}» скрыта из активных. Смотрите вкладку «Архив».`,
    primaryLabel: 'Комнаты',
    onPrimary: () => pushOsNav(objectTabRoute(role, 'rooms'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Вывоз мусора: create / request / approve / complete */
export function alertWasteOrderAdvanced(role: OsRole, action: 'created' | 'requested' | 'approved' | 'completed') {
  const titles = {
    created: 'Заявка на контейнер',
    requested: 'Вывоз заказан',
    approved: 'Вывоз согласован',
    completed: 'Мусор вывезен',
  } as const;
  const bodies = {
    created: 'Заказчик сможет согласовать вывоз. Сумма в материалах/бюджете.',
    requested: 'Ожидайте согласования заказчика.',
    approved: 'Исполнитель отметит факт вывоза.',
    completed: 'Расход зафиксирован. Сверьте факт в расходах.',
  } as const;

  if (action === 'completed') {
    showActionConfirm({
      title: titles.completed,
      message: bodies.completed,
      primaryLabel: 'Расходы',
      onPrimary: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
      secondaryLabel: 'Материалы',
      onSecondary: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
    });
    return;
  }

  showActionConfirm({
    title: titles[action],
    message: bodies[action],
    primaryLabel: 'Материалы',
    onPrimary: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Правка траты в карточке расхода */
export function alertExpenseUpdated(role: OsRole) {
  showActionConfirm({
    title: 'Трата обновлена',
    message: 'Fact бюджета пересчитан. Можно сверить сводку.',
    primaryLabel: 'Расходы',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
    secondaryLabel: 'Сводка',
    onSecondary: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
  });
}

/** Удаление траты */
export function alertExpenseDeleted(role: OsRole) {
  showActionConfirm({
    title: 'Трата удалена',
    message: 'Сумма убрана из факта бюджета.',
    primaryLabel: 'Сводка',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}
