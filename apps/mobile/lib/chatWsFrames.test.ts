import assert from 'node:assert/strict';
import { classifyChatFrame } from './chatWsFrames';

assert.equal(classifyChatFrame({ type: 'typing' }), 'typing');
for (const t of ['message', 'reaction', 'message_updated', 'message_edited', 'message_deleted', 'read', 'pin', 'confirm', 'participant_removed', 'thread_updated']) {
  assert.equal(classifyChatFrame({ type: t }), 'reload', t);
}
assert.equal(classifyChatFrame({ type: 'inbox', event: 'message' }), 'ignore');
assert.equal(classifyChatFrame({ type: 'something_new_from_server' }), 'ignore');
assert.equal(classifyChatFrame({ message: { id: 'x' } }), 'reload');
assert.equal(classifyChatFrame({}), 'ignore');
assert.equal(classifyChatFrame(null), 'ignore');
assert.equal(classifyChatFrame(undefined), 'ignore');
console.log('chatWsFrames ok');
