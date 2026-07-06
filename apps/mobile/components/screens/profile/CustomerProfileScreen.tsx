import { ScrollView, View, Text } from 'react-native';
import { usePathname } from 'expo-router';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { DockBarSettings } from '@/components/renova/os/DockBarSettings';
import { BudgetWidgetSettings } from '@/components/renova/os/BudgetWidgetSettings';
import { HomeWidgetSettings } from '@/components/renova/os/HomeWidgetSettings';
import { BudgetThresholdPicker } from '@/components/renova/BudgetThresholdPicker';
import { ContractorDirectory } from '@/components/renova/ContractorDirectory';
import { ViewerSharePanel } from '@/components/renova/ViewerSharePanel';
import { RoleSwitchButton } from '@/components/renova/RoleSwitchButton';
import { ProfileExtraLinks } from '@/components/renova/ProfileExtraLinks';
import { useRenova } from '@/lib/context/RenovaContext';
import { ProfileHeader } from './ProfileHeader';
import { ProfileSection } from './ProfileSection';
import { ProfileNotifications } from './ProfileNotifications';
import { profileScreenStyles as ps } from './profileScreenStyles';
import { pushOsNav } from '@/lib/pushOsNav';

const EXTRA_BASIC = [
  { label: 'Архив', desc: 'Лента событий', href: '/activity' },
  { label: 'Помощь', desc: 'Гид по ремонту', href: '/guide' },
];

/** После подключения исполнителя — архив и помощь; согласования через «Входящие» */
const EXTRA_WITH_CONTRACTOR: typeof EXTRA_BASIC = [];

export function CustomerProfileScreen() {
  const pathname = usePathname();
  const { user, activeProject, readOnly } = useRenova();
  const showAccess = Boolean(user && activeProject && !readOnly);
  const hasContractor = Boolean(activeProject?.contractor_id);
  const extraItems = hasContractor ? [...EXTRA_BASIC, ...EXTRA_WITH_CONTRACTOR] : EXTRA_BASIC;

  return (
    <ScrollView style={ps.scroll} contentContainerStyle={ps.content}>
      <ProfileHeader
        title="Профиль"
        name={user?.full_name || user?.phone}
        profileCode={user?.profile_code}
      />

      <ProfileSection
        title="Аккаунт"
        description="Смена объекта — через выбор в шапке или «Все проекты» на главной при нескольких объектах."
        bare
      >
        <RoleSwitchButton />
      </ProfileSection>

      {showAccess ? (
        <ProfileSection
          title="Доступ к объекту"
          description="Гости видят объект без редактирования. Исполнители — из базы Renova."
        >
          <ViewerSharePanel userId={user!.id} projectId={activeProject!.id} embedded />
          {user ? <ContractorDirectory userId={user.id} embedded /> : null}
        </ProfileSection>
      ) : null}

      <ProfileSection title="Персонализация" description="Три пресета главной. Детальные блоки — по ссылке «Настроить» внутри раздела.">
        <HomeWidgetSettings role="customer" embedded />
        <BudgetWidgetSettings role="customer" embedded />
        <DockBarSettings role="customer" embedded />
        <BudgetThresholdPicker embedded />
      </ProfileSection>

      {user ? (
        <ProfileSection title="Уведомления" description="Сводка по типам и отложение напоминаний.">
          <ProfileNotifications userId={user.id} />
        </ProfileSection>
      ) : null}

      <ProfileSection title="Проект" description="Документы и новый объект. Расход — кнопка «+» на любом экране.">
        <View style={ps.actionGap}>
          <PrimaryButton title="Документы проекта" variant="outline" onPress={() => pushOsNav('/documents', pathname)} />
          <PrimaryButton title="Новый проект" onPress={() => pushOsNav('/wizard/type', pathname)} />
        </View>
      </ProfileSection>

      <ProfileSection title="Ещё" description={hasContractor ? 'Архив и помощь. Согласования — во «Входящих».' : 'Архив и помощь. Согласования — после подключения исполнителя (входящие).'}>
        <ProfileExtraLinks items={extraItems} returnTo="/(customer)/(tabs)/profile" />
      </ProfileSection>
    </ScrollView>
  );
}
