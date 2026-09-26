/**
 * «Выйти на всех устройствах» отрабатывало молча.
 *
 * Результат показывался через `Alert.alert`, а в React Native Web он ничего
 * не рисует. На живом экране это выглядело так: первое нажатие — запрос
 * `POST /auth/sessions/revoke-all` вернул 200 и закрыл сессии, на экране
 * ничего; второе нажатие — 401, и снова ничего. Приложение продолжало
 * выглядеть залогиненным, хотя сервер поставил `tokens_invalid_before`
 * и токен этого устройства уже был мёртв.
 *
 * Проверка держит два условия: результат виден через общий механизм экрана,
 * и после успеха человека уводят на вход — потому что сервер вышел и здесь.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const dir = join(__dirname, '../components/screens/profile');
const screens = ['CustomerProfileScreen.tsx', 'ContractorProfileScreen.tsx'];

for (const name of screens) {
  const code = stripComments(readFileSync(join(dir, name), 'utf8'));

  const block = code.slice(code.indexOf('signOutEverywhere'));
  if (!block) throw new Error(`${name}: выход со всех устройств не вынесен в отдельный обработчик`);

  if (/revokeAllSessions[\s\S]{0,400}?Alert\.alert/.test(code)) {
    throw new Error(`${name}: результат выхода снова показывается через Alert — в вебе это молчание`);
  }
  if (!code.includes('showActionConfirm({')) {
    throw new Error(`${name}: результат выхода не показывается общим механизмом экрана`);
  }
  if (!/api\.revokeAllSessions\(/.test(code)) {
    throw new Error(`${name}: запрос на закрытие сессий пропал`);
  }
  // Успех обязан уводить на вход: сервер закрыл и эту сессию тоже.
  if (!/onPrimary: \(\) => \{ void leave\(\); \}/.test(code)) {
    throw new Error(`${name}: после выхода со всех устройств не уводит на вход`);
  }
  if (!/onDismiss: \(\) => \{ void leave\(\); \}/.test(code)) {
    throw new Error(`${name}: закрытие окна оставляет мёртвую сессию открытой`);
  }
  // `logout` только чистит состояние — без перехода человек остаётся на
  // профиле без данных, где вместо объекта написано «Нет данных проекта».
  if (!/await logout\(\);\s*router\.replace\('\/onboarding\/role'\);/.test(code)) {
    throw new Error(`${name}: после выхода не уводит на экран входа`);
  }
  if (!/logout \} = useRenova\(\)|, logout \} = useRenova\(\)/.test(code)) {
    throw new Error(`${name}: logout не подключён из контекста`);
  }
}

// Сервер действительно гасит и текущий токен — иначе уводить на вход не нужно
// и проверка выше была бы неправа.
const auth = readFileSync(join(__dirname, '../../../backend/app/api/v1/auth.py'), 'utf8');
const revoke = auth.slice(auth.indexOf('/sessions/revoke-all'));
if (!revoke.includes('user.tokens_invalid_before = utc_now()')) {
  throw new Error('сервер больше не гасит текущий токен — пересмотрите увод на вход');
}

console.log('signOutEverywhereVisible.test OK');
