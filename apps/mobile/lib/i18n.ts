import AsyncStorage from '@react-native-async-storage/async-storage';

/** Приложение для России — интерфейс только на русском */
export type Lang = 'ru';
const KEY = 'renova_lang';

const ru: Record<string, string> = {
  rooms: 'Комнаты', stages: 'Этапы', calendar: 'Календарь', chat: 'Связь', finance: 'Финансы',
  submit: 'Отправить', accept: 'Принять', readOnly: 'Гостевой доступ — только просмотр', send: 'Отправить',
  invite: 'Пригласить', team: 'Бригада', export: 'Экспорт', profile: 'Профиль', home: 'Главная',
  estimate: 'Смета', guide: 'Гид', loading: 'Загрузка…', error: 'Ошибка', save: 'Сохранить',
  cancel: 'Отмена', search: 'Поиск…', continue: 'Продолжить', customer: 'Заказчик', contractor: 'Исполнитель',
  ok: 'Готово', done: 'Готово', offline: 'Офлайн', planFact: 'План/факт', kpi: 'КПЭ',
  cashflow: 'Денежный поток', auditLog: 'Журнал аудита', smartMerge: 'Умное слияние',
  importIcal: 'Импорт календаря', exportData: 'Экспорт данных', server: 'Сервер',
  freePlan: 'Бесплатный тариф', proPlan: 'Про', gantt: 'Диаграмма Ганта',
};

let lang: Lang = 'ru';

export const t = (k: string) => ru[k] ?? k;
export const getLang = (): Lang => 'ru';

/** Всегда русский; сбрасываем сохранённый en при старте */
export async function initLang() {
  lang = 'ru';
  await AsyncStorage.setItem(KEY, 'ru');
}

/** Переключение языка отключено — приложение только для РФ */
export async function setLang(_l: Lang) {
  lang = 'ru';
  await AsyncStorage.setItem(KEY, 'ru');
}
