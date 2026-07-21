/** Smoke: provider_name matching — npx tsx lib/esignPoll.test.ts */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'esignPoll.ts'), 'utf8');
if (!src.includes('provider_name')) {
  throw new Error('esignPoll must match provider_name from API');
}
if (!src.includes('matchesProvider')) {
  throw new Error('esignPoll must use matchesProvider helper');
}
console.log('esignPoll.test OK');
