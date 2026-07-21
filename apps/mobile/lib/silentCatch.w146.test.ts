/** W146: no silent empty catch left in product TS/TSX (except comment in reportError). */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const re = /\.catch\(\(\)\s*=>\s*\{\s*\}\)/g;
const skip = new Set(['lib/reportError.ts', 'lib/failClosed.w144.test.ts', 'lib/oauthScaffold.w145.test.ts', 'lib/silentCatch.w146.test.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.includes('.test.')) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const file of walk(root)) {
  const rel = file.slice(root.length + 1).replace(/\\/g, '/');
  if (skip.has(rel)) continue;
  const text = readFileSync(file, 'utf8');
  if (re.test(text)) offenders.push(rel);
  re.lastIndex = 0;
}

if (offenders.length) {
  throw new Error('silent empty catch remains:\n' + offenders.join('\n'));
}
console.log('silentCatch.w146.test OK');
