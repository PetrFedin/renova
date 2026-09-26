import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, Platform } from 'react-native';
import { router } from 'expo-router';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { PortalSharePanel } from '@/components/renova/PortalSharePanel';
import { DockBarSettings } from '@/components/renova/os/DockBarSettings';
import { BudgetWidgetSettings } from '@/components/renova/os/BudgetWidgetSettings';
import { HomeWidgetSettings } from '@/components/renova/os/HomeWidgetSettings';
import { RoleSwitchButton, roleDisplayLabel } from '@/components/renova/RoleSwitchButton';
import { AdminHubLink } from '@/components/renova/AdminHubLink';
import { ProfileExtraLinks } from '@/components/renova/ProfileExtraLinks';
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
import { alertTeamInviteSent, alertTeamCreated, alertRequisitesSaved } from '@/lib/fieldCommsNav';
import * as WebBrowser from 'expo-web-browser';
import { reportCatch, reportError } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';

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
    api.getTeam(user.id).then(setTeam).catch((e) => { reportError('components.screens.profile.ContractorPro.Team', e); setTeam(null); });
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
                alertTeamInviteSent('contractor');
              } catch (e: unknown) {
                showActionConfirm({ title: 'Ошибка', message: e instanceof Error ? e.message : 'Не удалось пригласить' });
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
              alertTeamCreated('contractor');
            } catch (e: unknown) {
              setTeam(null);
              showActionConfirm({ title: 'Ошибка', message: e instanceof Error ? e.message : 'Не удалось создать бригаду' });
            }
          }}
        />
      )}
    </View>
  );
}

/**
 * Выход со всех устройств — включая это.
 *
 * Сервер в `revoke-all` не только гасит refresh-сессии, но и ставит
 * `tokens_invalid_before = сейчас`, то есть действующий токен этого устройства
 * тоже становится мёртвым. Экран же оставался открытым, как будто ничего не
 * произошло: результат показывался через `Alert.alert`, а он в вебе молчит.
 * Получалось так: первое нажатие возвращало 200 и закрывало сессии, экран не
 * менялся, человек нажимал ещё раз — приходил 401, и снова ни слова. Приложение
 * продолжало выглядеть залогиненным с нерабочим токеном.
 *
 * Теперь результат виден, а после успеха мы уводим на вход — ровно то, что
 * сделал сервер.
 */
async function signOutEverywhere(
  userId: string,
  logout: () => Promise<void>,
): Promise<void> {
  // `logout` только чистит состояние, увод с экрана — забота вызывающего:
  // тот же порядок, что в `app/onboarding/_screens/detail-quiz.tsx`. Без него
  // человек остаётся на профиле без данных, где вместо его объекта написано
  // «Нет данных проекта» — выглядит поломкой, хотя выход прошёл штатно.
  const leave = async () => {
    await logout();
    router.replace('/onboarding/role');
  };
  try {
    const r = await api.revokeAllSessions(userId);
    showActionConfirm({
      title: 'Вы вышли на всех устройствах',
      message: `Закрыто сессий: ${r.revoked}. Это устройство тоже вышло — войдите заново.`,
      primaryLabel: 'Войти',
      onPrimary: () => { void leave(); },
      onDismiss: () => { void leave(); },
    });
  } catch (e) {
    showActionConfirm({
      title: 'Не удалось выйти',
      message: e instanceof Error ? e.message : 'Попробуйте ещё раз.',
    });
  }
}

export function ContractorProfileScreen() {
  const nav = useNavFromHere();
  const { user, refreshMe, activeProject, logout } = useRenova();
  const [inn, setInn] = useState(user?.inn || '');
  const [msg, setMsg] = useState(user?.npd_verified ? 'НПД подтверждён' : '');
  const [payReq, setPayReq] = useState('');
  const [company, setCompany] = useState('');
  const reloadProfile = useCallback(() => {
    if (!user) return;
    api.getMyContractorProfile(user.id).then((p) => {
      setPayReq(p.payment_requisites || '');
      setCompany(p.company_name || '');
    }).catch(reportCatch('components.screens.profile.ContractorProfileScre.1'));
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
              alertRequisitesSaved('contractor');
            } catch {
              showActionConfirm({ title: 'Ошибка', message: 'Не удалось сохранить реквизиты' });
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
              await signOutEverywhere(user.id, logout);            }}
          />
        </View>
      </ProfileSection>

      <ProfileSection title="Дополнительно">
        <ProfileExtraLinks items={EXTRA_ITEMS} returnTo="/(contractor)/(tabs)/profile" role="contractor" />
      </ProfileSection>
    </ScrollView>
  );
}
