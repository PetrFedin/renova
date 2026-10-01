import assert from 'node:assert/strict';
import { guessAttachmentMime, base64DecodedBytes, validateChatAttachment, CHAT_ATTACHMENT_MAX_BYTES } from './chatAttachment';

assert.equal(base64DecodedBytes(''), 0);
assert.equal(base64DecodedBytes('QUJD'), 3);
assert.equal(base64DecodedBytes('QUI='), 2);
assert.equal(base64DecodedBytes('QQ=='), 1);

const ok = validateChatAttachment({ mimeType: 'image/png', base64: 'QUJD' });
assert.equal(ok.ok, true);
assert.equal(validateChatAttachment({ mimeType: 'image/jpg', base64: 'QUJD' }).ok, true);

const pdf = validateChatAttachment({ mimeType: 'application/pdf', base64: 'QUJD' });
assert.equal(pdf.ok, false);
if (!pdf.ok) assert.equal(pdf.reason, 'unsupported_type');
const video = validateChatAttachment({ mimeType: 'video/mp4', base64: 'QUJD' });
assert.equal(video.ok === false && video.reason, 'unsupported_type');
assert.equal(validateChatAttachment({ mimeType: null, base64: 'QUJD' }).ok, false);
assert.equal(validateChatAttachment({ mimeType: 'image/heic', base64: 'QUJD' }).ok, false);

const big = 'A'.repeat(Math.ceil(((CHAT_ATTACHMENT_MAX_BYTES + 10) * 4) / 3));
const tooBig = validateChatAttachment({ mimeType: 'image/jpeg', base64: big });
assert.equal(tooBig.ok === false && tooBig.reason, 'too_large');
if (!tooBig.ok) assert.match(tooBig.message, /10 МБ/);
assert.equal(validateChatAttachment({ mimeType: 'image/jpeg', base64: '' }).ok === false, true);
assert.equal(guessAttachmentMime({ mimeType: 'image/png' }), 'image/png');
assert.equal(guessAttachmentMime({ uri: 'data:image/webp;base64,AAAA' }), 'image/webp');
assert.equal(guessAttachmentMime({ uri: 'file:///x/IMG_1.JPG?v=1' }), 'image/jpeg');
assert.equal(guessAttachmentMime({ fileName: 'scan.pdf' }), 'application/pdf');
assert.equal(guessAttachmentMime({ uri: 'file:///x/noext' }), '');
console.log('chatAttachment ok');
