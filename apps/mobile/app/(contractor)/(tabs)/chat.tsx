import { View, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { OfflineSyncBanner } from '@/components/renova/OfflineSyncBanner';
import { ChatListView } from '@/components/renova/chat/ChatListView';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useRenova } from '@/lib/context/RenovaContext';

export default function ContractorChat() {
  const { user, projects } = useRenova();
  if (!user) return null;
  if (!projects.length) {
    return <ProjectEmptyState role="contractor" hint="Добавьте объект — здесь будут чаты с заказчиком." />;
  }
  return (
    <View style={styles.wrap}>
      <OfflineSyncBanner />
      <ChatListView />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
});
