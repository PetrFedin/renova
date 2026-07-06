import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'renova_nav_history';
const MAX = 3;

export async function pushNavHistory(path: string) {
  if (!path || path === '/') return;
  const raw = await AsyncStorage.getItem(KEY);
  const list: string[] = raw ? JSON.parse(raw) : [];
  const next = [path, ...list.filter((p) => p !== path)].slice(0, MAX);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function getNavHistory(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}

const LABELS: Record<string, string> = {
  '/onboarding/role': 'Выбор роли',
  '/onboarding/detail-quiz': 'Детализация',
  '/(customer)/(tabs)/estimate': 'Смета',
  '/(customer)/(tabs)/calendar': 'Календарь',
  '/(customer)/(tabs)/chat': 'Связь',
  '/(customer)/(tabs)/budget': 'Бюджет',
  '/(customer)/(tabs)/guide': 'Гид',
  '/guide': 'Гид',
  '/(customer)/(tabs)/profile': 'Профиль',
  '/(contractor)/(tabs)/estimate': 'Смета',
  '/(contractor)/(tabs)/calendar': 'Календарь',
  '/(contractor)/(tabs)/chat': 'Связь',
  '/(contractor)/(tabs)/profile': 'Профиль',
  '/(contractor)/(tabs)/budget': 'Бюджет',
  '/inbox': 'Входящие',
  '/conflicts': 'Конфликты синхронизации',
  '/wizard/type': 'Новый проект',

  '/(customer)/(tabs)': 'Главная',

  '/(customer)/(tabs)/object': 'Объект',
  '/(customer)/(tabs)/repair': 'Ремонт',
  '/(contractor)/(tabs)/object': 'Объект',
  '/(contractor)/(tabs)/repair': 'Ремонт',
  '/(customer)/(tabs)/works': 'Работы',
  '/(customer)/(tabs)/materials': 'Материалы',
  '/(customer)/(tabs)/control': 'Контроль',
  '/(customer)/(tabs)/more': 'Профиль',
  '/(contractor)/(tabs)/works': 'Работы',
  '/(contractor)/(tabs)/materials': 'Материалы',
  '/(contractor)/(tabs)/control': 'Контроль',
  '/(contractor)/(tabs)/more': 'Профиль',
  '/(customer)/(tabs)/rooms': 'Комнаты',
  '/(contractor)/(tabs)/': 'Главная',
};

export function pathLabel(p: string): string {
  if (LABELS[p]) return LABELS[p];
  if (p.startsWith('/stage/')) return 'Этап';
  if (p.startsWith('/room/')) return 'Комната';
  if (p.startsWith('/chat/')) return 'Чат';
  if (p.startsWith('/article/')) return 'Статья';
  if (p.includes('onboarding')) return 'Онбординг';
  if (p.includes('(tabs)')) return 'Главная';
  const tail = p.split('/').filter(Boolean).pop() || p;
  const ruTail: Record<string, string> = { role: 'Роль', wizard: 'Мастер', admin: 'Админ', audit: 'Аудит' };
  return ruTail[tail] || tail;
}
