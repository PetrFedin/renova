import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { PortalSharePanel } from '@/components/renova/PortalSharePanel';
import { DockBarSettings } from '@/components/renova/os/DockBarSettings';
import { BudgetWidgetSettings } from '@/components/renova/os/BudgetWidgetSettings';
import { HomeWidgetSettings } from '@/components/renova/os/HomeWidgetSettings';
import { RoleSwitchButton, roleDisplayLabel } from '@/components/renova/RoleSwitchButton';
import { AdminHubLink } from '@/components/renova/AdminHubLink';
import { ProfileExtraLinks } from '@/components/renova/ProfileExtraLinks';
import { NotificationsList } from '@/components/renova/NotificationsList';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useNavFromHere } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';
import { api } from '@/lib/api';
import { exportGdprJsonFile } from '@/lib/exportGdprJson';
import { ProfileHeader } from './ProfileHeader';
import { ProfileSection } from './ProfileSection';
import { profileScreenStyles as ps } from './profileScreenStyles';

/** Без дубля шапки «Ещё» (Архив там). Sprint IA. */
const EXTRA_ITEMS = [
  { label: 'Помощь', href: '/guide' },
  { label: 'Заявки', href: '/job-leads' },
];

function TeamSection() {
  const { user, activeProject } = useRenova();
  const nav = useNavFromHere();
  const [phone, setPhone] = useState('');
  const [team, setTeam] = useState<any>(null);

  const reloadTeam = useCallback(() => {
    if (!user) return;
    api.getTeam(user.id).then(setTeam).catch(() => setTeam(null));
  }, [user?.id]);
  useEffect(() => { reloadTeam(); }, [reloadTeam]);
  useProjectDataReload(reloadTeam);

  if (!user) return null;

  return (
    <View style={{ gap: 10 }}>
      {team ? (
        <>
          <Text style={ps.userName}>{team.name}</Text>
          <Text style={ps.userMeta}>Участников: {team.members?.length || 0}</Text>
          {team.members?.map((m: any) => (
            <Text key={m.user_id} style={ps.userMeta}>
              {m.phone} · {m.role}
            </Text>
          ))}
          <TextInput
            style={ps.input}
            placeholder="+7..."
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <PrimaryButton title="QR-код бригады" variant="outline" onPress={() => nav.href('/(contractor)/team-qr')} />
          <PrimaryButton
            title="Пригласить"
            variant="outline"
            onPress={async () => {
              try {
                await api.inviteTeamMember(user.id, phone);
                await syncProjectSideEffects({ user, project: activeProject });
                setTeam(await api.getTeam(user.id));
                setPhone('');
                Alert.alert('Готово', 'Приглашение отправлено');
              } catch (e: unknown) {
                Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось пригласить');
              }
            }}
          />
        </>
      ) : (
        <PrimaryButton
          title="Создать бригаду"
          variant="outline"
          onPress={async () => {
            try {
              await api.createTeam(user.id, 'Моя бригада');
              await syncProjectSideEffects({ user, project: activeProject });
              setTeam(await api.getTeam(user.id));
              Alert.alert('Готово', 'Бригада создана');
            } catch (e: unknown) {
              setTeam(null);
              Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось создать бригаду');
            }
          }}
        />
      )}
    </View>
  );
}

export function ContractorProfileScreen() {
  const nav = useNavFromHere();
  const { user, refreshMe, activeProject } = useRenova();
  const [inn, setInn] = useState(user?.inn || '');
  const [msg, setMsg] = useState(user?.npd_verified ? 'НПД подтверждён' : '');
  const [payReq, setPayReq] = useState('');
  const [company, setCompany] = useState('');
  const reloadProfile = useCallback(() => {
    if (!user) return;
    api.getMyContractorProfile(user.id).then((p) => {
      setPayReq(p.payment_requisites || '');
      setCompany(p.company_name || '');
    }).catch(() => {});
  }, [user?.id]);
  useEffect(() => { reloadProfile(); }, [reloadProfile]);
  useProjectDataReload(reloadProfile);
  const roleLabel = roleDisplayLabel(user?.role);

  return (
    <ScrollView style={ps.scroll} contentContainerStyle={ps.content}>
      <RoleSwitchButton />

      <ProfileHeader
        title="Исполнитель"
        name={user?.full_name || user?.phone}
        profileCode={user?.profile_code}
        badge={user?.npd_verified ? 'НПД подтверждён' : undefined}
      />

      <ProfileSection title="Аккаунт" bare>
        <Text style={ps.userMeta}>Сейчас: {roleLabel}</Text>
      </ProfileSection>

      <ProfileSection title="Реквизиты для оплаты">
        <Text style={ps.userMeta}>Заказчик увидит эти данные при переводе (СБП / карта / счёт). Без демо-карт.</Text>
        <TextInput
          style={ps.input}
          placeholder="Название ИП / ООО"
          value={company}
          onChangeText={setCompany}
        />
        <TextInput
          style={[ps.input, { minHeight: 88, textAlignVertical: 'top' }]}
          placeholder={"СБП · +7…\nБанк · карта/счёт"}
          value={payReq}
          onChangeText={setPayReq}
          multiline
        />
        <PrimaryButton
          title="Сохранить реквизиты"
          variant="outline"
          onPress={async () => {
            if (!user) return;
            try {
              await api.upsertContractorProfile(user.id, {
                company_name: company || null,
                payment_requisites: payReq || null,
              });
              Alert.alert('Сохранено', 'Реквизиты будут показаны заказчику при оплате.');
            } catch {
              Alert.alert('Ошибка', 'Не удалось сохранить реквизиты');
            }
          }}
        />
      </ProfileSection>

      <ProfileSection title="Персонализация">
        <HomeWidgetSettings role="contractor" embedded />
        <BudgetWidgetSettings role="contractor" embedded />
        <DockBarSettings role="contractor" embedded />
      </ProfileSection>

      {user ? (
        <ProfileSection title="Уведомления">
          <NotificationsList userId={user.id} defaultReturn="/(contractor)/(tabs)/profile" />
        </ProfileSection>
      ) : null}

      {user && activeProject ? (
        <ProfileSection title="Портал заказчика">
          <PortalSharePanel userId={user.id} projectId={activeProject.id} role="contractor" embedded />
        </ProfileSection>
      ) : null}

      <ProfileSection title="Бригада">
        <TeamSection />
      </ProfileSection>

      <ProfileSection title="Работа">
        <View style={ps.actionGap}>
          <PrimaryButton title="Согласования" variant="outline" onPress={() => pushOsNav('/approvals', nav.from, 'contractor')} />
          <PrimaryButton title="Документы объекта" variant="outline" onPress={() => pushOsNav('/documents', nav.from, 'contractor')} />
          <PrimaryButton title="Подписка Про" onPress={() => nav.href('/(contractor)/subscription')} />
          {Platform.OS === 'web' ? (
            <PrimaryButton
              title="Журнал аудита (веб-версия)"
              variant="outline"
              onPress={() => nav.href('/(contractor)/audit')}
            />
          ) : null}
          <AdminHubLink />
          <PrimaryButton title="Шаблоны чеклиста" variant="outline" onPress={() => nav.href('/checklist-templates')} />
        </View>
      </ProfileSection>

      <ProfileSection title="НПД и данные">
        <TextInput
          style={ps.input}
          placeholder="ИНН"
          value={inn}
          onChangeText={setInn}
          keyboardType="number-pad"
          maxLength={12}
        />
        <View style={ps.actionGap}>
          <PrimaryButton
            title="Проверить и сохранить НПД"
            variant="outline"
            onPress={async () => {
              if (!user || inn.length < 12) {
                Alert.alert('ИНН', 'Введите 12 цифр ИНН');
                return;
              }
              try {
                const r = (await api.verifyNpdMe(user.id, inn)) as any;
                setMsg(r.message || (r.is_npd ? 'НПД подтверждён — badge в профиле' : 'Не найден в реестре НПД'));
                await refreshMe();
              } catch {
                Alert.alert('ФНС', 'Сервис недоступен');
              }
            }}
          />
          <PrimaryButton
            title="Подключить «Мой налог»"
            variant="outline"
            onPress={async () => {
              if (!user) return;
              try {
                const r = await api.linkMoyNalog(user.id);
                setMsg(r.message);
              } catch {
                Alert.alert('Ошибка');
              }
            }}
          />
          <PrimaryButton
            title="Экспорт данных"
            variant="outline"
            onPress={async () => {
              if (!user) return;
              try {
                const data = await api.exportMyData(user.id);
                await exportGdprJsonFile(data, 'renova-export.json');
              } catch {
                Alert.alert('Ошибка', 'Не удалось выгрузить данные');
              }
            }}
          />
        </View>
        {msg ? <Text style={ps.msg}>{msg}</Text> : null}
      </ProfileSection>

      <ProfileSection title="Ещё">
        <ProfileExtraLinks items={EXTRA_ITEMS} returnTo="/(contractor)/(tabs)/profile" role="contractor" />
      </ProfileSection>
    </ScrollView>
  );
}
