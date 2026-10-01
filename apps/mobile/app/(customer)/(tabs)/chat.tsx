import { View, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { OfflineSyncBanner } from '@/components/renova/OfflineSyncBanner';
import { ChatListView } from '@/components/renova/chat/ChatListView';
import { useRenova } from '@/lib/context/RenovaContext';
import { OsTabFocusGate } from '@/components/renova/os/OsTabFocusGate';

function CustomerChatBody() {
  const { user } = useRenova();
  if (!user) return null;
  // BUD-33: a thread-only guest owns no projects but still has an inbox; the list
  // itself shows the empty state.
  return (
    <View style={styles.wrap}>
      <OfflineSyncBanner />
      <ChatListView />
    </View>
  );
}

export default function CustomerChat() {
  return (
    <OsTabFocusGate routeName="chat">
      <CustomerChatBody />
    </OsTabFocusGate>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
});
