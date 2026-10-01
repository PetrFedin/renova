/**
 * SCR-001/CMP-018: на web `Alert.alert` из react-native-web — пустая функция, поэтому
 * валидация, ошибки и подтверждения молча терялись. Весь пользовательский диалог идёт
 * через lib/notify.ts (native → Alert, web → ActionConfirmSheet).
 *
 * Ratchet: прямой `Alert.alert(` / `Alert.prompt(` и импорт `Alert` из react-native
 * запрещены вне lib/notify.ts и явного списка ALLOWED (должен оставаться пустым).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const root = join(__dirname, '..');
const ALLOWED = new Set<string>(['lib/notify.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.includes('.test.')) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const file of walk(root)) {
  const rel = relative(root, file).split('\\').join('/');
  if (ALLOWED.has(rel)) continue;
  const src = readFileSync(file, 'utf8');
  if (/\bAlert\s*\.\s*(alert|prompt)\s*\(/.test(src)) offenders.push(`${rel}: direct Alert call`);
  const rn = src.match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g) ?? [];
  if (rn.some((imp) => /\bAlert\b/.test(imp))) offenders.push(`${rel}: imports Alert from react-native`);
}
if (offenders.length) {
  throw new Error(`Use lib/notify (notifyAlert/notifyError/notifyInfo/confirmAction) instead of Alert:\n${offenders.join('\n')}`);
}

const notify = readFileSync(join(root, 'lib/notify.ts'), 'utf8');
for (const needle of ["Platform.OS === 'web'", 'showActionConfirm', 'export function notifyError', 'export function notifyInfo', 'export function confirmAction', 'Promise<boolean>']) {
  if (!notify.includes(needle)) throw new Error(`lib/notify.ts: missing ${needle}`);
}

console.log('notifyGuard.test OK');
