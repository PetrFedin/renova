/** Профиль обоих ролей содержит кнопку удаления аккаунта, а она ходит в проверку и DELETE. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

for (const f of ['CustomerProfileScreen', 'ContractorProfileScreen']) {
  const src = read(`components/screens/profile/${f}.tsx`);
  must(src.includes('<DeleteAccountButton />'), `${f} renders delete button`);
}
const btn = read('components/screens/profile/DeleteAccountButton.tsx');
must(btn.includes('accountDeletionCheck') && btn.includes('deleteMyAccount'), 'check then delete');
must(btn.includes('primaryDestructive: true'), 'destructive confirm');
must(btn.indexOf('accountDeletionCheck') < btn.indexOf('showActionConfirm({\n      title: \'Удалить аккаунт?\''), 'check precedes confirm');
must(btn.includes('await logout()'), 'local logout after delete');
const auth = read('lib/api/auth.ts');
must(auth.includes("'/api/v1/auth/me', { method: 'DELETE' }"), 'DELETE /auth/me');
console.log('deleteAccountWiring ok');
