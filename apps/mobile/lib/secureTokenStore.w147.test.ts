/** W147: SecureStore must not crash on web stub (isAvailableAsync gate). */
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, 'secureTokenStore.ts'), 'utf8');
const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

must(src.includes('isAvailableAsync'), 'must probe isAvailableAsync');
must(src.includes("Platform.OS === 'web'"), 'web uses AsyncStorage');
must(src.includes('withStoreFallback'), 'fallback on native mid-flight errors');
// Must not invoke native API by name in executable code (comment may mention the error)
const codeOnly = src.split('*/').pop() || src;
must(!/SecureStore\.setValueWithKeyAsync/.test(codeOnly), 'must not call native method directly');

console.log('secureTokenStore.w147.test OK');
