/**
 * Корень `/` отдаётся обеим группам вкладок. Без переноса заказчик после
 * перезагрузки видит главную исполнителя: «Заявки и новые объекты», чужой
 * док и чужие права.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const nav = src('components/renova/os/OsRoleTabsNavigator.tsx');
const domain = src('lib/domain/roleGroupRedirect.ts');
const index = src('app/index.tsx');

if (!nav.includes('roleGroupRootRedirectPath')) throw new Error('корень не переносится в свою группу');
if (!nav.includes('router.replace(rootRedirectTo')) throw new Error('перенос корня не применяется');
if (!/useEffect\(\(\) => \{\s*if \(!rootRedirectTo\) return;/.test(nav)) {
  throw new Error('перенос корня обязан идти после монтирования, а не в первом кадре');
}
if (!nav.includes('roleGroupRedirectPath(role, user?.role, pathname)')) {
  throw new Error('перенос обычных экранов пропал');
}

if (!domain.includes('export function roleGroupRootRedirectPath')) throw new Error('нет функции переноса корня');
if (!/if \(pathname !== '\/'\) return null;/.test(domain)) {
  throw new Error('функция корня обязана отвечать только за корень');
}

// app/index отвечает на тот же адрес и потому не может служить разводкой ролей.
if (!index.includes('osEntryRoute')) throw new Error('app/index перестал разводить вход');

console.log('roleGroupRootWired.test OK');
