import assert from 'node:assert/strict';
import { isUnsafeNavTarget, sanitizeReturnTo } from './safeNavTarget';
import { resolvePushLink } from './pushLinks';

for (const bad of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)', '\\\\evil', 'evil.example', '', undefined, null, 'http:/x', '/\\evil', '/ok\nx']) {
  assert.equal(sanitizeReturnTo(bad as string | undefined), undefined, `reject ${String(bad)}`);
}
for (const good of ['/', '/documents?returnTo=%2Fobject', '/(customer)/(tabs)/repair?tab=control', '/stage/abc']) {
  assert.equal(sanitizeReturnTo(good), good, `keep ${good}`);
}
assert.equal(isUnsafeNavTarget('https://evil.example'), true);
assert.equal(isUnsafeNavTarget('/object?next=https://x'), false);
assert.equal(isUnsafeNavTarget('//evil'), true);

// resolvePushLink не отдаёт внешний адрес как маршрут и не берёт его в returnTo.
assert.equal(resolvePushLink('https://evil.example/x', '/', 'customer'), null);
assert.equal(resolvePushLink('//evil.example', '/', 'customer'), null);
assert.equal(resolvePushLink('javascript:alert(1)', '/', 'customer'), null);
const t = resolvePushLink('/documents?returnTo=https://evil.example', '/object', 'customer');
assert.ok(t);
assert.notEqual(t!.params?.returnTo, 'https://evil.example');
const t2 = resolvePushLink('/documents', '//evil.example', 'customer');
assert.ok(t2 && t2.params?.returnTo === '/');

// SCR-005: голый /chat резолвится в группу роли.
assert.equal(resolvePushLink('/chat', '/', 'contractor')?.pathname, '/(contractor)/(tabs)/chat');
assert.equal(resolvePushLink('/chat', '/', 'customer')?.pathname, '/(customer)/(tabs)/chat');

console.log('safeNavTarget.test OK');
