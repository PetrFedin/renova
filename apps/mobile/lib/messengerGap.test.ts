import { MESSENGER_GAP, messengerShareMessage } from './messengerGap';

if (MESSENGER_GAP.nativeWhatsAppApi || MESSENGER_GAP.nativeTelegramBot) {
  throw new Error('native messenger APIs must stay false in MVP');
}
const m = messengerShareMessage('https://x.test/p', 'test');
if (!m.includes('WhatsApp') || !m.includes('https://x.test/p')) throw new Error('copy');
console.log('messengerGap.test OK');
