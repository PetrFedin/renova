import {
  clearActionConfirm,
  showActionConfirm,
  subscribeActionConfirm,
  type ActionConfirmPayload,
} from './actionConfirmBus';

let latest: ActionConfirmPayload | null = null;
const unsubscribe = subscribeActionConfirm((payload) => {
  latest = payload;
});

showActionConfirm({
  title: 'Удалить трату?',
  message: 'Действие необратимо.',
  primaryLabel: 'Удалить трату',
  primaryDestructive: true,
  onPrimary: () => undefined,
});

if (!latest?.primaryDestructive) {
  throw new Error('destructive primary action must be preserved by action confirm bus');
}

clearActionConfirm();
if (latest !== null) {
  throw new Error('clearActionConfirm must clear the active payload');
}

unsubscribe();
console.log('actionConfirmBus.test OK');
