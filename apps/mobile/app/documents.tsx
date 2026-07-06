import { ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { DocumentsHub } from '@/components/renova/DocumentsHub';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useRenova } from '@/lib/context/RenovaContext';
import { RenovaTheme } from '@/constants/Theme';

export default function DocumentsScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';

  if (!user) return null;
  if (!activeProject) {
    return (
      <>
        <BackHeader title="Документы" returnTo={returnTo} />
        <ProjectEmptyState role={role} hint="Выберите объект — документы привязаны к проекту." />
      </>
    );
  }

  return (
    <>
      <BackHeader title="Документы" returnTo={returnTo} subtitle={activeProject.name} />
      <ScrollView
        style={{ flex: 1, backgroundColor: RenovaTheme.colors.background }}
        contentContainerStyle={{ paddingTop: 8 }}
      >
        <DocumentsHub userId={user.id} projectId={activeProject.id} projectName={activeProject.name} />
      </ScrollView>
    </>
  );
}
