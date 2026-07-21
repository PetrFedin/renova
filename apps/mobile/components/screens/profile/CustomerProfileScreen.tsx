import { useEffect, useRef } from 'react';
import { Alert, ScrollView, View, Text, type LayoutChangeEvent } from 'react-native';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { DockBarSettings } from '@/components/renova/os/DockBarSettings';
import { BudgetWidgetSettings } from '@/components/renova/os/BudgetWidgetSettings';
import { HomeWidgetSettings } from '@/components/renova/os/HomeWidgetSettings';
import { BudgetThresholdPicker } from '@/components/renova/BudgetThresholdPicker';
import { ContractorInvitePanel } from '@/components/renova/ContractorInvitePanel';
import { ViewerSharePanel } from '@/components/renova/ViewerSharePanel';
import { PortalSharePanel } from '@/components/renova/PortalSharePanel';
import { RoleSwitchButton, roleDisplayLabel } from '@/components/renova/RoleSwitchButton';
import { ProfileExtraLinks } from '@/components/renova/ProfileExtraLinks';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { ProfileHeader } from './ProfileHeader';
import { ProfileSection } from './ProfileSection';
import { ProfileNotifications } from './ProfileNotifications';
import { profileScreenStyles as ps } from './profileScreenStyles';
import { pushOsNav } from '@/lib/pushOsNav';
import { reportCatch } from '@/lib/reportError';

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
  const scrollRef = useRef<ScrollView>(null);
  const contractorY = useRef(0);
  const focusContractor = focus === 'contractor';

  useEffect(() => {
    if (!focusContractor || !showAccess) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, contractorY.current - 12), animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [focusContractor, showAccess, activeProject?.id]);

  const onContractorLayout = (e: LayoutChangeEvent) => {
    contractorY.current = e.nativeEvent.layout.y;
  };

  return (
    <ScrollView ref={scrollRef} style={ps.scroll} contentContainerStyle={ps.content}>
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

          <View onLayout={onContractorLayout}>
            <ProfileSection title="Исполнитель" highlight={focusContractor}>
              {user ? (
                <ContractorInvitePanel
                  userId={user.id}
                  projectId={activeProject!.id}
                  linkedContractorId={activeProject!.contractor_id}
                  embedded
                  onLinked={() => loadProject(activeProject!.id).catch(reportCatch('components.screens.profile.CustomerProfileScreen.1'))}
                />
              ) : null}
            </ProfileSection>
          </View>

          <ProfileSection title="Клиентский портал">
            <PortalSharePanel userId={user!.id} projectId={activeProject!.id} role="customer" embedded />
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
          <PrimaryButton title="Документы проекта" variant="outline" onPress={() => pushOsNav('/documents', pathname, 'customer')} />
          <PrimaryButton title="Новый проект" onPress={() => pushOsNav('/wizard/type', pathname, 'customer')} />
        </View>
      </ProfileSection>

            <ProfileSection title="Безопасность">
        <View style={ps.actionGap}>
          <PrimaryButton
            title="Выйти на всех устройствах"
            variant="outline"
            onPress={async () => {
              if (!user?.id) return;
              try {
                const r = await api.revokeAllSessions(user.id);
                Alert.alert('Готово', `Сессий закрыто: ${r.revoked}. Войдите снова на других устройствах.`);
              } catch (e) {
                Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось');
              }
            }}
          />
        </View>
      </ProfileSection>

      <ProfileSection title="Ещё">
        <ProfileExtraLinks items={extraItems} returnTo="/(customer)/(tabs)/profile" role="customer" />
      </ProfileSection>
    </ScrollView>
  );
}
