import { roleGroupPrefix, roleGroupRedirectPath, roleGroupRootRedirectPath } from './roleGroupRedirect';

if (roleGroupPrefix('customer') !== '/(customer)/(tabs)') throw new Error('префикс заказчика');
if (roleGroupPrefix('contractor') !== '/(contractor)/(tabs)') throw new Error('префикс исполнителя');

// Своя группа — переносить некуда.
if (roleGroupRedirectPath('customer', 'customer', '/object') !== null) throw new Error('своя группа');
if (roleGroupRedirectPath('contractor', 'contractor', '/budget') !== null) throw new Error('своя группа исполнителя');

// Чужая группа на обычном экране — переносим, сохраняя путь.
if (roleGroupRedirectPath('contractor', 'customer', '/object') !== '/(customer)/(tabs)/object') {
  throw new Error('заказчик в группе исполнителя');
}
if (roleGroupRedirectPath('customer', 'contractor', '/repair') !== '/(contractor)/(tabs)/repair') {
  throw new Error('исполнитель в группе заказчика');
}

// Роль ещё не известна — не дёргаем человека.
if (roleGroupRedirectPath('contractor', null, '/object') !== null) throw new Error('роль неизвестна');
if (roleGroupRedirectPath('contractor', undefined, '/object') !== null) throw new Error('роль не пришла');

// Корень обычным путём не переносится: путь в первом кадре не установился.
if (roleGroupRedirectPath('contractor', 'customer', '/') !== null) throw new Error('корень здесь не трогаем');

// Корень — отдельная функция, применяется после монтирования.
if (roleGroupRootRedirectPath('contractor', 'customer', '/') !== '/(customer)/(tabs)/') {
  throw new Error('заказчик должен уехать на свою главную');
}
if (roleGroupRootRedirectPath('customer', 'contractor', '/') !== '/(contractor)/(tabs)/') {
  throw new Error('исполнитель должен уехать на свою главную');
}
if (roleGroupRootRedirectPath('customer', 'customer', '/') !== null) throw new Error('своя группа на корне');
if (roleGroupRootRedirectPath('contractor', 'customer', '/object') !== null) {
  throw new Error('не корень — не дело этой функции');
}
if (roleGroupRootRedirectPath('contractor', null, '/') !== null) throw new Error('роль неизвестна на корне');

// Неизвестная строка роли считается заказчиком — как и во всём приложении.
if (roleGroupRootRedirectPath('contractor', 'viewer', '/') !== '/(customer)/(tabs)/') {
  throw new Error('незнакомая роль трактуется как заказчик');
}

console.log('roleGroupRedirect.test OK');
