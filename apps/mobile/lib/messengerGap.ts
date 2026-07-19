/** W52: messenger product gap — pure flags + share copy (no RN imports). */

export const MESSENGER_GAP = {
  nativeWhatsAppApi: false,
  nativeTelegramBot: false,
  inAppChat: true,
  portalMagicLink: true,
  systemShareSheet: true,
} as const;

export function messengerShareMessage(url: string, context: string): string {
  return [
    `Renova — ${context}`,
    url,
    '',
    'Откройте ссылку в браузере или приложении.',
    'Можно переслать в WhatsApp / Telegram через «Поделиться».',
  ].join('\n');
}
