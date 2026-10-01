import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, Platform } from 'react-native';
import { router } from 'expo-router';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { PortalSharePanel } from '@/components/renova/PortalSharePanel';
import { ContractorClaimPanel } from '@/components/renova/ContractorClaimPanel';
import { DockBarSettings } from '@/components/renova/os/DockBarSettings';
import { BudgetWidgetSettings } from '@/components/renova/os/BudgetWidgetSettings';
import { HomeWidgetSettings } from '@/components/renova/os/HomeWidgetSettings';
import { RoleSwitchButton, roleDisplayLabel } from '@/components/renova/RoleSwitchButton';
import { AdminHubLink } from '@/components/renova/AdminHubLink';
import { useAdminAccess } from '@/lib/hooks/useAdminAccess';
import { ProfileExtraLinks } from '@/components/renova/ProfileExtraLinks';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useNavFromHere } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';
import { api } from '@/lib/api';
import { exportGdprJsonFile } from '@/lib/exportGdprJson';
import { ProfileHeader } from './ProfileHeader';
import { ProfileSection } from './ProfileSection';
import { profileScreenStyles as ps } from './profileScreenStyles';
import { DeleteAccountButton } from './DeleteAccountButton';
import { alertRequisitesSaved } from '@/lib/fieldCommsNav';
import { TeamSection } from './TeamSection';
import * as WebBrowser from 'expo-web-browser';
import { reportCatch } from '@/lib/reportError';
import { useBusyAction } from '@/lib/hooks/useBusyAction';
import { buildRequisitesPatch, canSaveProfile, validateProfileFields, type ProfileLoadState, type ProfileFields } from '@/lib/contractorProfileSave';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { writeResultMessage } from '@/lib/offlineResultMessage';

/** Без дубля шапки «Ещё» (Архив там). Sprint IA. */
const EXTRA_ITEMS = [
  { label: 'Помощь', href: '/guide' },
  { label: 'Заявки', href: '/job-leads' },
];

export function ContractorProfileScreen() {
  const nav = useNavFromHere();
  const adminAccess = useAdminAccess();
  const { user, refreshMe, activeProject } = useRenova();
  const [inn, setInn] = useState(user?.inn || '');
  const [msg, setMsg] = useState(user?.npd_verified ? 'НПД подтверждён' : '');
  const [payReq, setPayReq] = useState('');
  const [company, setCompany] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [profileState, setProfileState] = useState<ProfileLoadState>('loading');
  const profileBaseline = useRef<ProfileFields>({ company_name: '', payment_requisites: '', specialties: '', city: '', bio: '' });
  const saveAction = useBusyAction();
  const reloadProfile = useCallback(() => {
    if (!user) return;
    setProfileState((prev) => (prev === 'ready' ? prev : 'loading'));
    api.getMyContractorProfile(user.id).then((p) => {
      profileBaseline.current = {
        company_name: p.company_name || '',
        payment_requisites: p.payment_requisites || '',
        specialties: p.specialties || '',
        city: p.city || '',
        bio: p.bio || '',
      };
      setSpecialties(profileBaseline.current.specialties);
      setCity(profileBaseline.current.city);
      setBio(profileBaseline.current.bio);
      setPayReq(profileBaseline.current.payment_requisites);
      setCompany(profileBaseline.current.company_name);
      setProfileState('ready');
    }).catch((e) => {
      reportCatch('components.screens.profile.ContractorProfileScre.1')(e);
      // Поля остаются как были (если уже загружались), но сохранять без загруженного профиля нельзя.
      setProfileState((prev) => (prev === 'ready' ? prev : 'error'));
    });
  }, [user?.id]);
  useEffect(() => { reloadProfile(); }, [reloadProfile]);
  useProjectDataReload(reloadProfile);
  const profileErrors = validateProfileFields({ company_name: company, payment_requisites: payReq, specialties, city, bio });
  const profileErrorList = Object.values(profileErrors);
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

      {user ? (
        <ProfileSection title="Новый объект по коду">
          <ContractorClaimPanel userId={user.id} />
        </ProfileSection>
      ) : null}

      <ProfileSection title="Реквизиты для оплаты">
        <Text style={ps.userMeta}>Заказчик увидит эти данные при переводе (СБП / карта / счёт). Без демо-карт.</Text>
        {profileState === 'error' ? (
          <>
            <Text style={ps.userMeta}>Не удалось загрузить реквизиты. Сохранение отключено, чтобы не затереть данные.</Text>
            <PrimaryButton title="Повторить" variant="outline" onPress={reloadProfile} />
          </>
        ) : profileState === 'loading' ? (
          <Text style={ps.userMeta}>Загрузка реквизитов…</Text>
        ) : (
          <>
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
            <Text style={ps.userMeta}>Профиль в каталоге исполнителей</Text>
            <TextInput
              style={ps.input}
              placeholder="Специализации (через запятую)"
              value={specialties}
              onChangeText={setSpecialties}
            />
            <TextInput style={ps.input} placeholder="Город" value={city} onChangeText={setCity} />
            <TextInput
              style={[ps.input, { minHeight: 88, textAlignVertical: 'top' }]}
              placeholder="О себе: опыт, виды работ"
              value={bio}
              onChangeText={setBio}
              multiline
            />
            {profileErrorList.map((m) => (
              <Text key={m} style={ps.msg}>{m}</Text>
            ))}
            <PrimaryButton
              title="Сохранить профиль"
              variant="outline"
              loading={saveAction.busy}
              disabled={!canSaveProfile(profileState) || profileErrorList.length > 0}
              onPress={() => {
                if (!user || !canSaveProfile(profileState)) return;
                const patch = buildRequisitesPatch(profileBaseline.current, { company_name: company, payment_requisites: payReq, specialties, city, bio });
                if (Object.keys(patch).length === 0) {
                  showActionConfirm({ title: 'Нечего сохранять', message: 'Профиль не изменился.' });
                  return;
                }
                void saveAction.run(async () => {
                  await api.upsertContractorProfile(user.id, patch);
                  profileBaseline.current = { company_name: company.trim(), payment_requisites: payReq.trim(), specialties: specialties.trim(), city: city.trim(), bio: bio.trim() };
                  alertRequisitesSaved('contractor');
                }, 'Не удалось сохранить реквизиты');
              }}
            />
          </>
        )}
      </ProfileSection>

      <ProfileSection title="Персонализация">
        <HomeWidgetSettings role="contractor" embedded />
        <BudgetWidgetSettings role="contractor" embedded />
        <DockBarSettings role="contractor" embedded />
      </ProfileSection>

      {user ? (
        <ProfileSection title="Уведомления">
          <Text style={ps.userMeta}>Задачи, упоминания и уведомления собраны в едином Inbox.</Text>
          <PrimaryButton title="Открыть входящие" variant="outline" onPress={() => pushOsNav('/inbox', nav.from, 'contractor')} />
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
          <PrimaryButton title="Документы объекта" variant="outline" onPress={() => pushOsNav('/documents', nav.from, 'contractor')} />
          <PrimaryButton title="Подписка Про" onPress={() => nav.href('/subscription')} />
          {adminAccess === 'granted' ? (
            <PrimaryButton
              title="Журнал аудита"
              variant="outline"
              onPress={() => nav.href('/audit')}
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
                showActionConfirm({ title: 'ИНН', message: 'Введите 12 цифр ИНН' });
                return;
              }
              try {
                const r = (await api.verifyNpdMe(user.id, inn)) as any;
                setMsg(r.message || (r.is_npd ? 'НПД подтверждён — badge в профиле' : 'Не найден в реестре НПД'));
                await refreshMe();
              } catch {
                showActionConfirm({ title: 'ФНС', message: 'Сервис недоступен' });
              }
            }}
          />
          <PrimaryButton
            title="Авторизовать «Мой налог» (OAuth)"
            variant="outline"
            onPress={async () => {
              if (!user) return;
              try {
                const start = await api.moyNalogOAuthStart(user.id);
                setMsg(start.message);
                if (start.auth_url) {
                  await WebBrowser.openBrowserAsync(start.auth_url);
                  showActionConfirm({
                    title: 'Мой налог',
                    message: 'После входа в ЛК НПД вернитесь в приложение. Если code не пришёл автоматически — статус останется authorization_started.',
                  });
                } else if (start.state) {
                  // Dev: demo complete без CLIENT_ID
                  const done = await api.moyNalogOAuthCallback(user.id, {
                    state: start.state,
                    demo_complete: true,
                  });
                  setMsg(done.message);
                }
                await refreshMe();
              } catch (e: any) {
                showActionConfirm({ title: 'Мой налог', message: e?.message || 'OAuth недоступен' });
              }
            }}
          />
          <PrimaryButton
            title="Включить флаг (без OAuth)"
            variant="outline"
            onPress={async () => {
              if (!user) return;
              try {
                const r = await api.linkMoyNalog(user.id) as { message?: string; mode?: string; linked?: boolean; status?: string };
                setMsg(r.message || `Статус: ${r.status || 'updated'}`);
                await refreshMe();
              } catch (e: any) {
                showActionConfirm({ title: 'Мой налог', message: e?.message || 'Интеграция недоступна (нужен OAuth или MOY_NALOG_ENABLED)' });
              }
            }}
          />
          {user?.moy_nalog_linked || (user?.moy_nalog_status && user.moy_nalog_status !== 'not_connected') ? (
            <Text style={ps.msg}>
              «Мой налог»: {user?.moy_nalog_status || 'linked'} — без OAuth ФНС это не live-подключение.
            </Text>
          ) : null}
          {user?.moy_nalog_linked ? (
            <PrimaryButton
              title="Отключить «Мой налог»"
              variant="outline"
              onPress={async () => {
                if (!user) return;
                try {
                  const r = await api.unlinkMoyNalog(user.id);
                  setMsg(r.message || 'Связь снята');
                  await refreshMe();
                } catch (e: any) {
                  showActionConfirm({ title: 'Мой налог', message: e?.message || 'Не удалось отключить' });
                }
              }}
            />
          ) : null}
          <PrimaryButton
            title="Экспорт данных"
            variant="outline"
            onPress={async () => {
              if (!user) return;
              try {
                const data = await api.exportMyData(user.id);
                await exportGdprJsonFile(data, 'renova-export.json');
              } catch {
                showActionConfirm({ title: 'Ошибка', message: 'Не удалось выгрузить данные' });
              }
            }}
          />
        </View>
        {msg ? <Text style={ps.msg}>{msg}</Text> : null}
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
                showActionConfirm({ title: 'Готово', message: `Сессий закрыто: ${r.revoked}. Войдите снова на других устройствах.` });
              } catch (e) {
                showActionConfirm({ title: 'Ошибка', message: writeResultMessage(e, 'Не удалось') });
              }
            }}
          />
          <DeleteAccountButton />
        </View>
      </ProfileSection>

      <ProfileSection title="Дополнительно">
        <ProfileExtraLinks items={EXTRA_ITEMS} returnTo="/(contractor)/(tabs)/profile" role="contractor" />
      </ProfileSection>
    </ScrollView>
  );
}
