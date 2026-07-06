/** Выбор объекта после входа — до главной OS */
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RenovaTheme } from '@/constants/Theme';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useRenova } from '@/lib/context/RenovaContext';
import { SESSION_KEYS } from '@/constants/sessionKeys';
import { osEntryRoute } from '@/lib/osEntry';
import type { OsRole } from '@/constants/osSections';
import { formMetaText } from '@/constants/formTypography';

export default function ProjectPickScreen() {
  const { user, loadProject } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';

  const enterProject = async (projectId: string) => {
    await loadProject(projectId);
    await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
    await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
    router.replace(osEntryRoute(role) as any);
  };

  return (
    <View style={s.wrap}>
      <Text style={s.logo}>Renova</Text>
      <Text style={s.title}>Выберите объект</Text>
      <Text style={formMetaText.caption}>
        Откройте существующий проект или создайте новый — без автоподстановки демо.
      </Text>
      <ProjectEmptyState
        role={role}
        title="Ваши объекты"
        hint="Нажмите карточку — откроется главная выбранного объекта."
        autoPick={false}
        hideHomeButton
        onSelectProject={enterProject}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background, padding: 16 },
  logo: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.primary, textAlign: 'center', marginTop: 24 },
  title: { fontSize: 18, fontWeight: '700', color: RenovaTheme.colors.text, textAlign: 'center', marginTop: 8, marginBottom: 6 },
});
