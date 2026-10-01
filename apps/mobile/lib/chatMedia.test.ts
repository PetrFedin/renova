import assert from 'node:assert/strict';
import { resolveChatMediaRequest } from './chatMedia';

const API = 'http://127.0.0.1:8100';
const a = resolveChatMediaRequest('http://localhost:8100/api/v1/media/chat-media/t1/abc.png', API);
assert.deepEqual(a, { uri: 'http://127.0.0.1:8100/api/v1/media/chat-media/t1/abc.png', authorized: true });
assert.deepEqual(
  resolveChatMediaRequest('/api/v1/media/chat-media/t1/abc.png', `${API}/`),
  { uri: 'http://127.0.0.1:8100/api/v1/media/chat-media/t1/abc.png', authorized: true },
);
// чужой хост без /api/v1/media — токен не отдаём
assert.deepEqual(resolveChatMediaRequest('https://evil.example/pic.png', API), { uri: 'https://evil.example/pic.png', authorized: false });
// чужой хост с media-подобным путём всё равно уходит на НАШ API (токен не покидает его)
assert.equal(resolveChatMediaRequest('https://evil.example/api/v1/media/x.png', API).uri.startsWith(API), true);
assert.equal(resolveChatMediaRequest('not a url', API).authorized, false);
console.log('chatMedia ok');
