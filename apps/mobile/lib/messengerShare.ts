/** W52: system Share sheet wrapper. */
import { Share, Platform } from 'react-native';
import { messengerShareMessage } from '@/lib/messengerGap';

export { MESSENGER_GAP, messengerShareMessage } from '@/lib/messengerGap';

export async function shareRenovaLink(url: string, context: string): Promise<void> {
  const message = messengerShareMessage(url, context);
  if (Platform.OS === 'ios') {
    await Share.share({ message, url });
  } else {
    await Share.share({ message, title: context });
  }
}
