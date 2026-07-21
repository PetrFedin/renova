/** W137: CTA «Подключить исполнителя» → профиль аккаунта, не паспорт объекта */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const rooms = readFileSync(join(mobile, 'components/screens/OsRoomsScreen.tsx'), 'utf8');
const postCreate = readFileSync(join(mobile, 'components/renova/os/home/PostCreateSheet.tsx'), 'utf8');
const checklist = readFileSync(join(mobile, 'lib/domain/buildSetupChecklist.ts'), 'utf8');
const pushLinks = readFileSync(join(mobile, 'lib/pushLinks.ts'), 'utf8');
const osSections = readFileSync(join(mobile, 'constants/osSections.ts'), 'utf8');

console.assert(osSections.includes('export function customerProfileTabHref'), 'customerProfileTabHref SoT');
console.assert(rooms.includes("customerProfileTabHref('customer', 'contractor')"), 'rooms CTA → account profile');
console.assert(!rooms.includes("objectTabHref('customer', 'profile')"), 'rooms must not open object passport for invite');
console.assert(postCreate.includes("customerProfileTabHref('customer', 'contractor')"), 'post-create SoT');
console.assert(checklist.includes("customerProfileTabHref(role, 'contractor')"), 'setup checklist SoT');
console.assert(pushLinks.includes("q.get('focus')"), 'profile alias keeps focus');

console.log('connectContractorNav.w137.test OK');
