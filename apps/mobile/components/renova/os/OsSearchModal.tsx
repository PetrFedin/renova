/** Глобальный поиск по проекту — модалка из шапки OS */
import { Modal, View, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { GlobalSearchBar } from '@/components/renova/GlobalSearchBar';
import { useHomeSearchHints } from '@/lib/useHomeSearchHints';
import type { ProjectDetail } from '@/lib/api';

export function OsSearchModal({
  visible,
  onClose,
  project,
  userId,
}: {
  visible: boolean;
  onClose: () => void;
  project: ProjectDetail;
  userId: string;
}) {
  const suggestions = useHomeSearchHints();
  const returnTo = usePathname();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Pressable style={s.close} onPress={onClose}>
          <View style={s.closeBar} />
        </Pressable>
        <GlobalSearchBar project={project} userId={userId} suggestions={suggestions} returnTo={returnTo} />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background, paddingTop: 56, paddingHorizontal: 16 },
  close: { alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
  closeBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: RenovaTheme.colors.border },
});
