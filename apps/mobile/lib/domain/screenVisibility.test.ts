/**
 * screenVisibility + foreground mark-read policy.
 * Run: npx tsx apps/mobile/lib/domain/screenVisibility.test.ts
 */
import {
  evaluateMarkReadAllowed,
  evaluateScreenVisible,
  isForegroundLifecycle,
  pushReceiptImpliesRead,
  PUSH_OPEN_READ_POLICY,
  type ScreenVisibilityInput,
} from './screenVisibility';
import { evaluateCanMarkChatRead, shouldFireMarkRead } from './canMarkChatRead';
import {
  clearIncomingMessageDedupe,
  decideIncomingChatMessage,
} from './incomingChatMessage';
import type { ActiveThreadContext } from './activeThreadContext';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const visible: ScreenVisibilityInput = {
  appForeground: true,
  screenFocused: true,
  threadIdMatches: true,
  loggedIn: true,
  overlayBlocking: false,
  threadContentReady: true,
  mounted: true,
};

// --- lifecycle ---
assert(isForegroundLifecycle('active'), 'foreground active');
assert(!isForegroundLifecycle('background'), 'background');
assert(!isForegroundLifecycle('inactive'), 'inactive / lock screen');
assert(
  !isForegroundLifecycle('active', { webDocumentVisible: false }),
  'web hidden tab',
);
assert(
  isForegroundLifecycle('active', { webDocumentVisible: true }),
  'web visible tab',
);

// --- mark-read gate matrix ---
assert(evaluateScreenVisible(visible), 'foreground visible');
assert(evaluateMarkReadAllowed(visible), 'mark allowed when visible');

assert(!evaluateScreenVisible({ ...visible, appForeground: false }), 'bg no visible');
assert(!evaluateMarkReadAllowed({ ...visible, appForeground: false }), 'bg no mark');

assert(!evaluateMarkReadAllowed({ ...visible, screenFocused: false }), 'nav away');
assert(!evaluateMarkReadAllowed({ ...visible, overlayBlocking: true }), 'modal');
assert(!evaluateMarkReadAllowed({ ...visible, threadContentReady: false }), 'not ready');
assert(!evaluateMarkReadAllowed({ ...visible, threadIdMatches: false }), 'wrong thread');
assert(!evaluateMarkReadAllowed({ ...visible, loggedIn: false }), 'logout');
assert(!evaluateMarkReadAllowed({ ...visible, mounted: false }), 'unmount');

// canMarkChatRead compose
assert(evaluateCanMarkChatRead({
  screenFocused: true,
  appForeground: true,
  threadLoaded: true,
  accessConfirmed: true,
  latestMessagesRendered: true,
}), 'compose ready');

assert(!evaluateCanMarkChatRead({
  screenFocused: true,
  appForeground: false,
  threadLoaded: true,
  accessConfirmed: true,
  latestMessagesRendered: true,
}), 'compose background');

assert(!evaluateCanMarkChatRead({
  screenFocused: true,
  appForeground: true,
  threadLoaded: true,
  accessConfirmed: true,
  latestMessagesRendered: true,
  overlayBlocking: true,
}), 'compose modal');

// edge: background → foreground re-fires
assert(shouldFireMarkRead(false, true), 'bg→fg edge');
assert(!shouldFireMarkRead(true, true), 'stay fg no re-fire');
assert(shouldFireMarkRead(false, true), 'after reset edge');

// --- push ≠ read ---
assert(pushReceiptImpliesRead() === false, 'push receipt not read');
assert(PUSH_OPEN_READ_POLICY.marksReadOnReceive === false, 'push receive');
assert(PUSH_OPEN_READ_POLICY.marksReadOnOpen === false, 'push open');
assert(PUSH_OPEN_READ_POLICY.marksReadAfterVisibleLoad === true, 'push after visible');
assert(PUSH_OPEN_READ_POLICY.navigatesToThread === true, 'push navigates');

// --- incoming during background / transition ---
clearIncomingMessageDedupe();
const reading: ActiveThreadContext = {
  threadId: 't1',
  userId: 'u1',
  projectId: 'p1',
  screenFocused: true,
  appForeground: true,
  messagesVisible: true,
  threadLoaded: true,
  accessConfirmed: true,
};

{
  const d = decideIncomingChatMessage({
    event: { messageId: 'fg1', threadId: 't1' },
    active: reading,
  });
  assert(d.shouldMarkRead && !d.bumpUnread, 'foreground mark');
}

{
  const d = decideIncomingChatMessage({
    event: { messageId: 'bg1', threadId: 't1' },
    active: { ...reading, appForeground: false, messagesVisible: false },
  });
  assert(d.bumpUnread && !d.shouldMarkRead, 'background delivery bumps unread');
}

{
  // inactive (lock) — как background
  const d = decideIncomingChatMessage({
    event: { messageId: 'lock1', threadId: 't1' },
    active: { ...reading, appForeground: false },
  });
  assert(d.bumpUnread && !d.shouldMarkRead, 'lock screen bump');
}

{
  // reconnect in background — accept message, bump, no mark
  const d = decideIncomingChatMessage({
    event: { messageId: 're1', threadId: 't1' },
    active: { ...reading, appForeground: false, messagesVisible: false },
  });
  assert(d.accept && d.bumpUnread && !d.shouldMarkRead, 'reconnect background');
}

{
  // message during transition: focus ещё true, но foreground уже false
  const d = decideIncomingChatMessage({
    event: { messageId: 'tr1', threadId: 't1' },
    active: { ...reading, appForeground: false, screenFocused: true },
  });
  assert(d.bumpUnread && !d.shouldMarkRead, 'transition arrival');
}

{
  // navigation away
  const d = decideIncomingChatMessage({
    event: { messageId: 'nav1', threadId: 't1' },
    active: { ...reading, screenFocused: false },
  });
  assert(d.bumpUnread && !d.shouldMarkRead, 'nav away');
}

{
  // modal
  const d = decideIncomingChatMessage({
    event: { messageId: 'mod1', threadId: 't1' },
    active: { ...reading, messagesVisible: false },
  });
  assert(d.bumpUnread && !d.shouldMarkRead, 'modal');
}

{
  // push received while thread "open" but background — bump
  const d = decideIncomingChatMessage({
    event: { messageId: 'push1', threadId: 't1' },
    active: { ...reading, appForeground: false },
  });
  assert(!d.shouldMarkRead, 'push received no mark');
}

console.log('screenVisibility.test OK');
