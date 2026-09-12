/** Выбор объекта после входа — до главной OS */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RenovaTheme } from '@/constants/Theme';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { SESSION_KEYS } from '@/constants/sessionKeys';
import { osEntryRoute } from '@/lib/osEntry';
import { replaceOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { alertMessage } from '@/lib/confirmAlert';

export default function ProjectPickScreen() {
  const { user, projects, loadProject, recoverSession, loading: contextLoading } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';

  const [entering, setEntering] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [autoRecoveryStarted, setAutoRecoveryStarted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const recoverProjects = useCallback(async () => {
    if (recovering) return;
    setRecovering(true);
    setLoadError(null);
    try {
      await recoverSession();
    } catch (e: any) {
      setLoadError(e?.message || 'Не удалось загрузить демо-объекты');
    } finally {
      setRecovering(false);
    }
  }, [recovering, recoverSession]);

  useEffect(() => {
    if (!user) {
      replaceOsNav('/onboarding/role');
      return;
    }
    // demoLogin commits identity and project state in separate React updates. The
    // picker can therefore render once with a valid user and an empty project list.
    // Starting recovery in that transient frame launches a second demo auth which
    // can race the explicit project selection and reset the active project. Give the
    // authoritative hand-off a short cancellable grace period first.
    if (contextLoading || projects.length > 0 || autoRecoveryStarted) return;
    const timer = setTimeout(() => {
      setAutoRecoveryStarted(true);
      void recoverProjects();
    }, 500);
    return () => clearTimeout(timer);
  }, [user?.id, contextLoading, projects.length, autoRecoveryStarted, recoverProjects]);

  useEffect(() => {
    if (projects.length > 0) setLoadError(null);
  }, [projects.length]);

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

  const noProjects = projects.length === 0;

  return (
    <View style={s.wrap}>
      <Text style={s.logo}>Renova</Text>
      <Text style={s.title}>Выберите объект</Text>
      {noProjects ? (
        <View style={s.recovery}>
          {recovering || contextLoading ? (
            <>
              <ActivityIndicator color={RenovaTheme.colors.primary} size="large" />
              <Text style={s.recoveryText}>Загружаем демо-объекты…</Text>
            </>
          ) : (
            <>
              <Text style={s.recoveryText}>
                {loadError || 'Демо-объекты пока не загрузились. Можно повторить подключение без нового входа.'}
              </Text>
              <PrimaryButton title="Повторить загрузку" onPress={() => { void recoverProjects(); }} />
            </>
          )}
        </View>
      ) : (
        <View style={s.list}>
          <ProjectEmptyState
            role={role}
            autoPick={false}
            hideHomeButton
            onSelectProject={enterProject}
          />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background, padding: 16 },
  logo: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.primary, textAlign: 'center', marginTop: 24 },
  title: { fontSize: 18, fontWeight: '700', color: RenovaTheme.colors.text, textAlign: 'center', marginTop: 8, marginBottom: 6 },
  list: { flex: 1, minHeight: 0 },
  recovery: { flex: 1, justifyContent: 'center', gap: 16, paddingHorizontal: 12 },
  recoveryText: { color: RenovaTheme.colors.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 20 },
});
