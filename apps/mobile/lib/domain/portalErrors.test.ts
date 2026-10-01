import assert from 'node:assert/strict';
import { portalLoadErrorMessage, PORTAL_LINK_INVALID_MESSAGE } from './portalErrors';

assert.equal(portalLoadErrorMessage({ status: 401, message: 'invalid_portal_token', code: 'invalid_portal_token' }), PORTAL_LINK_INVALID_MESSAGE);
assert.equal(portalLoadErrorMessage({ message: 'invalid_portal_token' }), PORTAL_LINK_INVALID_MESSAGE);
assert.match(portalLoadErrorMessage({ status: 0, message: 'Failed to fetch' }), /Нет связи/);
assert.match(portalLoadErrorMessage({ status: 429 }), /Слишком много/);
assert.doesNotMatch(portalLoadErrorMessage({ status: 500, message: 'internal_error' }), /internal_error/);
assert.equal(portalLoadErrorMessage({ status: 500, message: 'Объект недоступен' }), 'Объект недоступен');
assert.ok(portalLoadErrorMessage(undefined).length > 10);
console.log('portalErrors.test ok');
