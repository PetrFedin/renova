import { View, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { OfflineSyncBanner } from '@/components/renova/OfflineSyncBanner';
import { ChatListView } from '@/components/renova/chat/ChatListView';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useRenova } from '@/lib/context/RenovaContext';
import { OsTabFocusGate } from '@/components/renova/os/OsTabFocusGate';

function CustomerChatBody() {
  const { user, projects } = useRenova();
  if (!user) return null;
  if (!projects.length) {
    return <ProjectEmptyState role="customer" hint="Создайте объект — здесь будут все чаты с исполнителем." />;
  }
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
