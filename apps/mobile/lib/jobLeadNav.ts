/** W130: заявки / старт этапа / бригада / WO → SoT (Houzz leads + Fieldwire field ops) */
import { Alert } from 'react-native';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  calendarTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';

export function alertJobLeadCreated(role: OsRole) {
  Alert.alert(
    'Заявка создана',
    'Исполнители увидят объект и смогут прислать КП.',
    [
      { text: 'OK' },
      {
        text: 'К заявкам',
        onPress: () => pushOsNav('/job-leads', undefined, role),
      },
    ],
  );
}

export function alertJobLeadQuoted(role: OsRole) {
  Alert.alert(
    'КП отправлено',
    'Заказчик получит оценку. После принятия — объект в кабинете.',
    [
      { text: 'OK' },
      {
        text: 'К заявкам',
        onPress: () => pushOsNav('/job-leads', undefined, role),
      },
    ],
  );
}

export function alertJobLeadAssigned(role: OsRole) {
  Alert.alert(
    'Исполнитель подобран',
    'Дождитесь КП или продолжите переписку в заявке.',
    [{ text: 'OK' }],
  );
}

/** Этап начат — даты в графике (B6 honesty + CTA) */
export function alertStageStarted(role: OsRole) {
  Alert.alert(
    'Этап начат',
    'Сроки отражены в графике. Назначьте работы или откройте календарь.',
    [
      { text: 'OK' },
      {
        text: 'График',
        onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
      },
      {
        text: 'Работы',
        onPress: () => pushOsNav(repairTabRoute(role, 'works'), undefined, role),
      },
    ],
  );
}

/** Скан invite QR — в бригаде */
export function alertTeamJoined(role: OsRole = 'contractor') {
  Alert.alert(
    'Вы в бригаде',
    'Откройте главную объекта или календарь задач.',
    [
      { text: 'OK' },
      {
        text: 'На главную',
        onPress: () => replaceOsNav(`/(${role})/(tabs)/`, undefined, role),
      },
      {
        text: 'График',
        onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
      },
    ],
  );
}

/** Переход WorkOrder — следующие шаги golden path */
export function alertWorkOrderAdvanced(role: OsRole, next: string) {
  if (next === 'review') {
    Alert.alert(
      'На приёмке',
      'Заказчик может принять работы по этапу или замечанию.',
      [
        { text: 'OK' },
        {
          text: 'Приёмка',
          onPress: () => pushOsNav(repairTabRoute(role, 'control'), undefined, role),
        },
      ],
    );
    return;
  }
  if (next === 'done') {
    Alert.alert(
      'Работа выполнена',
      'Можно выставить оплату или открыть график.',
      [
        { text: 'OK' },
        {
          text: 'Оплаты',
          onPress: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
        },
        {
          text: 'График',
          onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
        },
      ],
    );
    return;
  }
  if (next === 'paid') {
    Alert.alert(
      'Оплачено',
      'Сумма в бюджете. Сверьте расходы при необходимости.',
      [
        { text: 'OK' },
        {
          text: 'Бюджет',
          onPress: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
        },
      ],
    );
    return;
  }
  if (next === 'in_progress') {
    Alert.alert(
      'В работе',
      'Этап и календарь обновятся на главной.',
      [
        { text: 'OK' },
        {
          text: 'График',
          onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
        },
      ],
    );
  }
}
