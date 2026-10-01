import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { TeamRolePicker } from '@/components/renova/TeamRolePicker';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useNavFromHere } from '@/lib/navigation';
import { api } from '@/lib/api';
import type { OwnerTeamInvite, TeamInvitation } from '@/lib/api/teamOps';
import { reportError } from '@/lib/reportError';
import { requireSuccessfulTeamInvite } from '@/lib/teamJoinFlow';
import {
  canEditMember,
  canManageTeam,
  canonicalInvitePhone,
  ownerInviteLabel,
  resolveInviteRole,
  resolveTeamView,
  teamErrorMessage,
  teamRoleLabel,
  type TeamLike,
  type TeamLoadOutcome,
  type TeamRoleId,
} from '@/lib/teamsUi';
import { alertTeamInviteSent, alertTeamCreated } from '@/lib/fieldCommsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { writeResultMessage } from '@/lib/offlineResultMessage';
import { profileScreenStyles as ps } from './profileScreenStyles';

/** Бригада исполнителя: состав, приглашения (с принятием), роли (MKT-013/022/023/035). */
export function TeamSection() {
  const { user, activeProject } = useRenova();
  const nav = useNavFromHere();
  const [phone, setPhone] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRoleId>('member');
  const [outcome, setOutcome] = useState<TeamLoadOutcome | null>(null);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [ownerInvites, setOwnerInvites] = useState<OwnerTeamInvite[]>([]);
  const [busy, setBusy] = useState(false);
  const lastTeam = useRef<TeamLike | null>(null);

  const reloadTeam = useCallback(async () => {
    if (!user) return;
    try {
      const team = (await api.getTeam(user.id)) as TeamLike | null;
      lastTeam.current = team;
      setOutcome({ kind: 'loaded', team });
    } catch (e) {
      reportError('components.screens.profile.TeamSection.team', e);
      // Ошибка загрузки — не «команды нет» (MKT-035).
      setOutcome({ kind: 'failed' });
    }
    try {
      setInvitations((await api.listTeamInvitations(user.id)).items);
    } catch (e) {
      reportError('components.screens.profile.TeamSection.invitations', e);
    }
    try {
      setOwnerInvites((await api.listOwnerTeamInvites(user.id)).items);
    } catch (e) {
      // 403 для не-владельца и сбой сети: список просто не показываем (не «приглашений нет»).
      reportError('components.screens.profile.TeamSection.ownerInvites', e);
      setOwnerInvites([]);
    }
  }, [user?.id]);
  useEffect(() => { void reloadTeam(); }, [reloadTeam]);
  useProjectDataReload(() => { void reloadTeam(); });

  if (!user) return null;
  const view = resolveTeamView(outcome, lastTeam.current);
  const team = view.state === 'ready' ? view.team : null;
  const isOwner = canManageTeam(team, user.id);

  const respond = async (inv: TeamInvitation, decision: 'accept' | 'decline') => {
    setBusy(true);
    try {
      await api.respondTeamInvitation(user.id, inv.id, decision);
      if (decision === 'accept') await syncProjectSideEffects({ user, project: activeProject });
      await reloadTeam();
    } catch (e: unknown) {
      showActionConfirm({ title: 'Приглашение', message: teamErrorMessage(e, 'Не удалось ответить на приглашение') });
      await reloadTeam();
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (memberId: string, role: TeamRoleId) => {
    setBusy(true);
    try {
      await api.setMemberRole(user.id, memberId, role);
      await reloadTeam();
    } catch (e: unknown) {
      showActionConfirm({ title: 'Не удалось изменить роль', message: teamErrorMessage(e, writeResultMessage(e, 'Повторите позже')) });
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = (inv: OwnerTeamInvite) =>
    showActionConfirm({
      title: 'Отозвать приглашение?',
      message: 'Ссылка или приглашение перестанет действовать, принять его будет нельзя.',
      primaryLabel: 'Отозвать',
      onPrimary: async () => {
        try {
          await api.revokeOwnerTeamInvite(user.id, inv.id);
        } catch (e: unknown) {
          showActionConfirm({ title: 'Не удалось отозвать', message: teamErrorMessage(e, writeResultMessage(e, 'Повторите позже')) });
        }
        await reloadTeam();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });

  const sendInvite = async () => {
    const canonical = canonicalInvitePhone(phone);
    if (!canonical) {
      showActionConfirm({ title: 'Номер телефона', message: 'Введите номер в формате +7 999 123-45-67' });
      return;
    }
    setBusy(true);
    try {
      // 4xx приходит исключением; ok:false в теле (старый сервер) тоже не выдаём за успех.
      requireSuccessfulTeamInvite(await api.inviteTeamMember(user.id, canonical, resolveInviteRole(inviteRole)));
      setPhone('');
      alertTeamInviteSent('contractor');
      await reloadTeam();
    } catch (e: unknown) {
      showActionConfirm({ title: 'Не удалось пригласить', message: teamErrorMessage(e, 'Повторите позже') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      {invitations.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={ps.userName}>Приглашения в бригаду</Text>
          {invitations.map((inv) => (
            <View key={inv.id} style={{ gap: 6 }}>
              <Text style={ps.userMeta}>«{inv.team_name}» · роль: {teamRoleLabel(inv.role)}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <PrimaryButton title="Принять" compact disabled={busy} onPress={() => respond(inv, 'accept')} />
                <PrimaryButton title="Отклонить" variant="outline" compact disabled={busy} onPress={() => respond(inv, 'decline')} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {view.state === 'loading' ? <Text style={ps.userMeta}>Загрузка бригады…</Text> : null}

      {view.state === 'error' ? (
        <>
          <Text style={ps.userMeta}>Не удалось загрузить бригаду. Это не значит, что её нет.</Text>
          <PrimaryButton title="Повторить" variant="outline" onPress={() => void reloadTeam()} />
        </>
      ) : null}

      {team ? (
        <>
          <Text style={ps.userName}>{team.name}</Text>
          <Text style={ps.userMeta}>Участников: {team.members?.length || 0}</Text>
          {team.members?.map((m) => (
            <View key={m.user_id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={[ps.userMeta, { flexShrink: 1 }]}>
                  {m.phone} · {teamRoleLabel(m.role)}
                </Text>
                {canEditMember(team, user.id, m) ? (
                  <PrimaryButton
                    title="Убрать"
                    variant="outline"
                    compact
                    onPress={() =>
                      showActionConfirm({
                        title: 'Убрать из бригады?',
                        message: `${m.phone} потеряет доступ к вашим объектам, открытые назначения на этапы будут сняты.`,
                        primaryLabel: 'Убрать',
                        onPrimary: async () => {
                          try {
                            await api.removeTeamMember(user.id, m.user_id);
                            await syncProjectSideEffects({ user, project: activeProject });
                            await reloadTeam();
                          } catch (e: unknown) {
                            showActionConfirm({ title: 'Не удалось убрать', message: writeResultMessage(e, 'Повторите позже') });
                          }
                        },
                        secondaryLabel: 'Отмена',
                        onSecondary: () => undefined,
                      })
                    }
                  />
                ) : null}
              </View>
              {canEditMember(team, user.id, m) ? (
                <TeamRolePicker value={m.role} disabled={busy} onChange={(role) => void changeRole(m.user_id, role)} />
              ) : null}
            </View>
          ))}
          {!isOwner ? (
            <PrimaryButton
              title="Выйти из бригады"
              variant="outline"
              onPress={() =>
                showActionConfirm({
                  title: 'Выйти из бригады?',
                  message: 'Вы потеряете доступ к объектам владельца бригады.',
                  primaryLabel: 'Выйти',
                  onPrimary: async () => {
                    try {
                      await api.leaveTeam(user.id);
                      await syncProjectSideEffects({ user, project: activeProject });
                      lastTeam.current = null;
                      await reloadTeam();
                    } catch (e: unknown) {
                      showActionConfirm({ title: 'Не удалось выйти', message: writeResultMessage(e, 'Повторите позже') });
                    }
                  },
                  secondaryLabel: 'Отмена',
                  onSecondary: () => undefined,
                })
              }
            />
          ) : null}
          {isOwner ? (
            <>
              <Text style={ps.userMeta}>Пригласить по телефону — приглашение придёт участнику, он сам его примет.</Text>
              <TextInput
                style={ps.input}
                placeholder="+7..."
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
              <TeamRolePicker value={inviteRole} onChange={setInviteRole} disabled={busy} />
              <PrimaryButton title="Пригласить" variant="outline" disabled={busy} onPress={sendInvite} />
              {ownerInvites.length > 0 ? (
                <View style={{ gap: 6 }}>
                  <Text style={ps.userName}>Действующие приглашения</Text>
                  {ownerInvites.map((inv) => (
                    <View key={inv.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={[ps.userMeta, { flexShrink: 1 }]}>{ownerInviteLabel(inv)}</Text>
                      <PrimaryButton title="Отозвать" variant="outline" compact disabled={busy} onPress={() => revokeInvite(inv)} />
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
          <PrimaryButton title="QR-код бригады" variant="outline" onPress={() => nav.href('/team-qr')} />
        </>
      ) : null}

      {view.state === 'none' ? (
        <PrimaryButton
          title="Создать бригаду"
          variant="outline"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await api.createTeam(user.id, 'Моя бригада');
              await syncProjectSideEffects({ user, project: activeProject });
              await reloadTeam();
              alertTeamCreated('contractor');
            } catch (e: unknown) {
              showActionConfirm({ title: 'Ошибка', message: writeResultMessage(e, 'Не удалось создать бригаду') });
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </View>
  );
}
