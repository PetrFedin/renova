/** Investor P2: DocumentsHub deep-link «в раздел» по source/kind */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const nav = readFileSync(join(mobile, 'lib/documentSectionNav.ts'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');

const ok =
  nav.includes('documentSectionTarget') &&
  nav.includes("source === 'receipt'") &&
  nav.includes("source === 'acceptance'") &&
  nav.includes('budgetTabRoute') &&
  nav.includes('repairTabRoute') &&
  docs.includes('documentSectionTarget') &&
  docs.includes('section.label') &&
  !docs.includes("text: 'К объекту',\n          onPress: () => {\n            const role");

console.assert(ok, 'document section deep-link');
if (!ok) process.exit(1);
console.log('documentSectionNav.w151.test OK');
