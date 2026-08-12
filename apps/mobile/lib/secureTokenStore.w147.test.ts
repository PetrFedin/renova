/** W147: SecureStore is web-safe and native credential storage fails closed. */
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, 'secureTokenStore.ts'), 'utf8');
const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

must(src.includes('isAvailableAsync'), 'must probe isAvailableAsync');
must(src.includes("Platform.OS === 'web'"), 'web may explicitly use AsyncStorage');
must(src.includes("throw new Error('secure_store_unavailable')"), 'native unavailable SecureStore must fail closed');
must(src.includes("reportError('secureTokenStore.resolve'"), 'native SecureStore resolution failures must be observable');
must(src.includes("reportError('secureTokenStore.operation'"), 'native SecureStore operation failures must be observable');
must(!src.includes('withStoreFallback'), 'native secrets must never use a storage fallback helper');
must(!src.includes('return op(asyncStore)'), 'native operation failure must never retry in AsyncStorage');
// Must not invoke native API by name in executable code (comment may mention the error)
const codeOnly = src.split('*/').pop() || src;
must(!/SecureStore\.setValueWithKeyAsync/.test(codeOnly), 'must not call native method directly');

console.log('secureTokenStore.w147.test OK');
