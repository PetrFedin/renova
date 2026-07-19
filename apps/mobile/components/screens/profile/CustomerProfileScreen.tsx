import { ScrollView, View, Text } from 'react-native';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { DockBarSettings } from '@/components/renova/os/DockBarSettings';
import { BudgetWidgetSettings } from '@/components/renova/os/BudgetWidgetSettings';
import { HomeWidgetSettings } from '@/components/renova/os/HomeWidgetSettings';
import { BudgetThresholdPicker } from '@/components/renova/BudgetThresholdPicker';
import { ContractorInvitePanel } from '@/components/renova/ContractorInvitePanel';
import { ViewerSharePanel } from '@/components/renova/ViewerSharePanel';
import { RoleSwitchButton, roleDisplayLabel } from '@/components/renova/RoleSwitchButton';
import { ProfileExtraLinks } from '@/components/renova/ProfileExtraLinks';
import { useRenova } from '@/lib/context/RenovaContext';
import { ProfileHeader } from './ProfileHeader';
import { ProfileSection } from './ProfileSection';
import { ProfileNotifications } from './ProfileNotifications';
import { profileScreenStyles as ps } from './profileScreenStyles';
import { pushOsNav } from '@/lib/pushOsNav';

const EXTRA_BASIC = [
  { label: 'Помощь', href: '/guide' },
];

/** После подключения исполнителя — доп. ссылки; архив в шапке «Ещё», согласования через inbox */
const EXTRA_WITH_CONTRACTOR: typeof EXTRA_BASIC = [];

export function CustomerProfileScreen() {
  const pathname = usePathname();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { user, activeProject, readOnly, loadProject } = useRenova();
  const showAccess = Boolean(user && activeProject && !readOnly);
  const hasContractor = Boolean(activeProject?.contractor_id);
  const extraItems = hasContractor ? [...EXTRA_BASIC, ...EXTRA_WITH_CONTRACTOR] : EXTRA_BASIC;
  const roleLabel = roleDisplayLabel(user?.role);

  return (
    <ScrollView style={ps.scroll} contentContainerStyle={ps.content}>
      <RoleSwitchButton />

      <ProfileHeader
        title="Заказчик"
        name={user?.full_name || user?.phone}
        profileCode={user?.profile_code}
      />

      <ProfileSection title="Аккаунт" bare>
        <Text style={ps.userMeta}>Сейчас: {roleLabel}</Text>
      </ProfileSection>

      {showAccess ? (
        <>
          <Text style={ps.accessObject} numberOfLines={2}>{activeProject!.name}</Text>

          <ProfileSection title="Исполнитель" highlight={focus === 'contractor'}>
            {user ? (
              <ContractorInvitePanel
                userId={user.id}
                projectId={activeProject!.id}
                linkedContractorId={activeProject!.contractor_id}
                embedded
                onLinked={() => loadProject(activeProject!.id).catch(() => {})}
              />
            ) : null}
          </ProfileSection>

          <ProfileSection title="Гости">
            <ViewerSharePanel userId={user!.id} projectId={activeProject!.id} embedded />
          </ProfileSection>
        </>
      ) : null}

      <ProfileSection title="Персонализация">
        <HomeWidgetSettings role="customer" embedded />
        <BudgetWidgetSettings role="customer" embedded />
        <DockBarSettings role="customer" embedded />
        <BudgetThresholdPicker embedded />
      </ProfileSection>

      {user ? (
        <ProfileSection title="Уведомления">
          <ProfileNotifications userId={user.id} />
        </ProfileSection>
      ) : null}

      <ProfileSection title="Проект">
        <View style={ps.actionGap}>
          <PrimaryButton title="Документы проекта" variant="outline" onPress={() => pushOsNav('/documents', pathname)} />
          <PrimaryButton title="Новый проект" onPress={() => pushOsNav('/wizard/type', pathname)} />
        </View>
      </ProfileSection>

      <ProfileSection title="Ещё">
        <ProfileExtraLinks items={extraItems} returnTo="/(customer)/(tabs)/profile" />
      </ProfileSection>
    </ScrollView>
  );
}
