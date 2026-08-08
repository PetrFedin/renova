import {
  clearActionConfirm,
  showActionConfirm,
  subscribeActionConfirm,
  type ActionConfirmPayload,
} from './actionConfirmBus';

const seen: Array<ActionConfirmPayload | null> = [];
const unsubscribe = subscribeActionConfirm((payload) => {
  seen.push(payload);
});

showActionConfirm({
  title: 'Удалить трату?',
  message: 'Действие необратимо.',
  primaryLabel: 'Удалить трату',
  primaryDestructive: true,
  onPrimary: () => undefined,
});

const shown = seen[seen.length - 1];
if (!shown || !shown.primaryDestructive) {
  throw new Error('destructive primary action must be preserved by action confirm bus');
}

clearActionConfirm();
if (seen[seen.length - 1] !== null) {
  throw new Error('clearActionConfirm must clear the active payload');
}

unsubscribe();
console.log('actionConfirmBus.test OK');
