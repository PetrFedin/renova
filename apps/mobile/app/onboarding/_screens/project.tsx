/** Выбор объекта после входа — до главной OS */
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RenovaTheme } from '@/constants/Theme';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useRenova } from '@/lib/context/RenovaContext';
import { SESSION_KEYS } from '@/constants/sessionKeys';
import { osEntryRoute } from '@/lib/osEntry';
import { replaceOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { alertMessage } from '@/lib/confirmAlert';

export default function ProjectPickScreen() {
  const { user, loadProject } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';

  const [entering, setEntering] = useState(false);

  const enterProject = async (projectId: string) => {
    if (entering) return;
    setEntering(true);
    try {
      await loadProject(projectId);
      await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
      await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
      replaceOsNav(osEntryRoute(role));
    } catch (e: any) {
      alertMessage('Не удалось открыть объект', e?.message || 'Повторите попытку');
    } finally {
      setEntering(false);
    }
  };

  return (
    <View style={s.wrap}>
      <Text style={s.logo}>Renova</Text>
      <Text style={s.title}>Выберите объект</Text>
      <View style={s.list}>
        <ProjectEmptyState
          role={role}
          autoPick={false}
          hideHomeButton
          onSelectProject={enterProject}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background, padding: 16 },
  logo: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.primary, textAlign: 'center', marginTop: 24 },
  title: { fontSize: 18, fontWeight: '700', color: RenovaTheme.colors.text, textAlign: 'center', marginTop: 8, marginBottom: 6 },
  list: { flex: 1, minHeight: 0 },
});
