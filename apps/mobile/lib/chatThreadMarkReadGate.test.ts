/**
 * Lifecycle gate: mark-read только после render commit + focus + foreground.
 * Run: npx tsx apps/mobile/lib/chatThreadMarkReadGate.test.ts
 */
import { shouldMarkThreadReadAfterCommit } from './chatThreadMarkReadGate';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const base = {
  threadId: 't1',
  chatId: 't1',
  messagesReady: true,
  loadFailed: false,
  isFocused: true,
  appState: 'active' as const,
  hasMessagesArray: true,
};

assert(shouldMarkThreadReadAfterCommit(base) === true, 'happy path');

assert(shouldMarkThreadReadAfterCommit({ ...base, loadFailed: true }) === false, 'load error');
assert(shouldMarkThreadReadAfterCommit({ ...base, messagesReady: false }) === false, 'before commit');
assert(shouldMarkThreadReadAfterCommit({ ...base, appState: 'background' }) === false, 'background');
assert(shouldMarkThreadReadAfterCommit({ ...base, isFocused: false }) === false, 'unfocused mounted');
assert(shouldMarkThreadReadAfterCommit({ ...base, chatId: 'other' }) === false, 'stale thread');
assert(shouldMarkThreadReadAfterCommit({ ...base, hasMessagesArray: false }) === false, 'no messages yet');

console.log('chatThreadMarkReadGate.test OK');
