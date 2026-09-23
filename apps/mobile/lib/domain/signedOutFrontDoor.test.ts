/**
 * Человек без аккаунта попадал не на вход, а на чужую главную.
 *
 * Адрес `/` обслуживают и `app/index.tsx`, и групповые
 * `(customer)/(tabs)/index` с `(contractor)/(tabs)/index`. Роутер выбирает
 * групповой, и редирект из `app/index.tsx` — единственное место, где
 * проверялось «пользователя нет», — не выполняется вовсе.
 *
 * На живом стенде это выглядело так: чистый вход без токена показывает
 * главную заказчика с надписью «Нет данных проекта / Нажмите "Загрузить
 * демо"» и нижнюю панель. Войти или зарегистрироваться с этого экрана
 * нельзя — сам баннер рассчитан на того, кто уже вошёл («Создайте объект
 * или войдите снова»).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  roleGroupRedirectPath,
  roleGroupRootRedirectPath,
  signedOutRedirectPath,
} from './roleGroupRedirect';

// 1. Нет сессии и загрузка закончена — уводим на вход.
if (signedOutRedirectPath(null, false) !== '/onboarding/role') throw new Error('без роли не уводит на вход');
if (signedOutRedirectPath(undefined, false) !== '/onboarding/role') throw new Error('undefined не уводит на вход');
if (signedOutRedirectPath('', false) !== '/onboarding/role') throw new Error('пустая роль не уводит на вход');

// 2. Пока идёт восстановление сессии — не трогаем. Иначе каждый холодный
//    старт выбрасывал бы вошедшего человека на экран входа.
if (signedOutRedirectPath(null, true) !== null) throw new Error('увод во время загрузки');
if (signedOutRedirectPath('customer', true) !== null) throw new Error('увод вошедшего во время загрузки');

// 3. Есть сессия — уводить некуда, дальше работают правила ролей.
for (const role of ['customer', 'contractor', 'viewer']) {
  if (signedOutRedirectPath(role, false) !== null) throw new Error(`${role}: лишний увод на вход`);
}

// 4. Прежние правила без роли по-прежнему молчат — именно поэтому и
//    понадобилась отдельная проверка на отсутствие сессии.
if (roleGroupRedirectPath('customer', null, '/object') !== null) throw new Error('правило ролей заговорило без роли');
if (roleGroupRootRedirectPath('customer', null, '/') !== null) throw new Error('корневое правило заговорило без роли');

// 5. Макет вкладок обязан спрашивать это правило и уходить до отрисовки.
const nav = readFileSync(
  join(__dirname, '../../components/renova/os/OsRoleTabsNavigator.tsx'),
  'utf8',
);
const code = nav.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
if (!code.includes('signedOutRedirectPath(')) {
  throw new Error('макет вкладок не спрашивает, есть ли вообще сессия');
}
const guardAt = code.indexOf('if (signedOutTo)');
const slotAt = code.indexOf('<Slot />');
if (guardAt < 0) throw new Error('нет выхода до отрисовки');
if (slotAt >= 0 && guardAt > slotAt) throw new Error('увод стоит после отрисовки экрана');

console.log('signedOutFrontDoor.test OK');
