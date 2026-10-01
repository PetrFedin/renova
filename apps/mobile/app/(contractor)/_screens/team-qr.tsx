import { BackHeader } from '@/components/renova/BackHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Share, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { pushOsNav } from '@/lib/pushOsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { alertTeamJoined } from '@/lib/jobLeadNav';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api } from '@/lib/api';
import { reportError } from '@/lib/reportError';
import { RenovaTheme } from '@/constants/Theme';
import { QrCodeImage } from '@/components/renova/QrCodeImage';
import { parseTeamInviteToken, requireSuccessfulTeamJoin, teamJoinErrorMessage } from '@/lib/teamJoinFlow';
import { qrScreenMode, resolveTeamView, TEAM_ROLES, type TeamLike, type TeamLoadOutcome, type TeamRoleId } from '@/lib/teamsUi';
import { writeResultMessage } from '@/lib/offlineResultMessage';

const ROLES = TEAM_ROLES;
type RoleId = TeamRoleId;

export default function TeamQrScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { activeProject, user } = useRenova();
  const [perm, req] = useCameraPermissions();
  const [role, setRole] = useState<RoleId>('member');
  const [link, setLink] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  // MKT-021: открытие экрана только читает команду; ссылку/бригаду создаёт явная кнопка.
  const [outcome, setOutcome] = useState<TeamLoadOutcome | null>(null);
  // onBarcodeScanned стреляет многократно, пока камера видит код: один токен — одна попытка.
  const joiningRef = useRef(false);

  const loadTeam = useCallback(async () => {
    if (!user) return;
    try {
      setOutcome({ kind: 'loaded', team: (await api.getTeam(user.id)) as TeamLike | null });
    } catch (e) {
      reportError('teamQr.loadTeam', e, { userId: user.id });
      setOutcome({ kind: 'failed' });
    }
  }, [user?.id]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const mode = qrScreenMode(resolveTeamView(outcome), user?.id);

  const refreshLink = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const l = await api.createTeamInviteLink(user.id, role);
      setLink(l.link);
      await loadTeam();
    } catch (e: unknown) {
      const msg = writeResultMessage(e, 'Создайте бригаду в профиле');
      // W67 #35
      // Clarity T: Pro gate / error через sheet с CTA
      const isPro = /402|pro|подписк/i.test(msg);
      showActionConfirm({
        title: 'Бригада',
        message: isPro
          ? 'QR бригады доступен на Pro. Откройте «Подписка» или используйте staging с trial.'
          : msg,
        ...(isPro
          ? {
              primaryLabel: 'Подписка',
              onPrimary: () => pushOsNav('/subscription', undefined, 'contractor'),
              secondaryLabel: 'Позже',
              onSecondary: () => undefined,
            }
          : { primaryLabel: 'Понятно', onPrimary: () => undefined }),
      });
    } finally {
      setBusy(false);
    }
  }, [user?.id, role, loadTeam]);

  return (
    <>
      <BackHeader title="Бригада QR" returnTo={returnTo} />
      <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={s.h}>Роль по ссылке</Text>
        <Text style={s.sub}>Сканирует новый исполнитель → входит в вашу бригаду с выбранной ролью (H1.5). На staging без Pro invite может быть недоступен — см. подписку.</Text>
        <View style={s.roles}>
          {ROLES.map((r) => (
            <Pressable key={r.id} onPress={() => { setRole(r.id); setLink(''); }} style={[s.roleChip, role === r.id && s.roleOn]}>
              <Text style={[s.roleT, role === r.id && s.roleTOn]}>{r.label}</Text>
              <Text style={s.roleHint}>{r.hint}</Text>
            </Pressable>
          ))}
        </View>

        {mode === 'loading' ? <Text style={s.sub}>Загрузка бригады…</Text> : null}
        {mode === 'error' ? (
          <>
            <Text style={s.sub}>Не удалось загрузить бригаду. Это не значит, что её нет.</Text>
            <PrimaryButton title="Повторить" variant="outline" onPress={() => void loadTeam()} />
          </>
        ) : null}
        {mode === 'member' ? (
          <Text style={s.sub}>Вы участник чужой бригады: ссылки-приглашения создаёт её владелец.</Text>
        ) : null}
        {mode === 'no-team' ? (
          <Text style={s.sub}>У вас пока нет бригады. Ссылка создаст бригаду «Бригада».</Text>
        ) : null}
        <Text style={s.link} selectable>
          {link || (busy ? 'Генерируем…' : 'Ссылка ещё не создана')}
        </Text>
        {link ? <QrCodeImage value={link} size={200} /> : null}

        <View style={s.row}>
          <PrimaryButton
            title="Копировать"
            variant="outline"
            compact
            disabled={!link}
            onPress={async () => {
              if (!link) return;
              await Clipboard.setStringAsync(link);
              showActionConfirm({ title: 'Скопировано', message: 'Отправьте ссылку в WhatsApp / Telegram' });
            }}
          />
          <PrimaryButton
            title="Поделиться"
            variant="outline"
            compact
            disabled={!link}
            onPress={async () => {
              if (!link) return;
              await Share.share({ message: `Renova — вход в бригаду (${ROLES.find((x) => x.id === role)?.label}): ${link}` });
            }}
          />
        </View>
        {mode === 'owner' || mode === 'no-team' ? (
          <PrimaryButton
            title={link ? 'Создать новую ссылку' : mode === 'no-team' ? 'Создать бригаду и ссылку' : 'Создать ссылку'}
            variant="outline"
            disabled={busy}
            onPress={refreshLink}
          />
        ) : null}

        <PrimaryButton title={scan ? 'Стоп сканер' : 'Сканировать invite'} onPress={() => setScan(!scan)} />
        {!perm?.granted && scan ? <PrimaryButton title="Разрешить камеру" onPress={req} /> : null}
        {scan && perm?.granted ? (
          <CameraView
            style={s.cam}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={async ({ data }) => {
              if (joiningRef.current || !user) return;
              const token = parseTeamInviteToken(data);
              if (!token) return;
              joiningRef.current = true;
              setScan(false);
              try {
                // joinTeam отвечает 200 {ok:false,message} на неверный/использованный токен —
                // успех показываем только после requireSuccessfulTeamJoin.
                requireSuccessfulTeamJoin(await api.joinTeam(user.id, token));
              } catch (e: unknown) {
                joiningRef.current = false;
                showActionConfirm({
                  title: 'Не удалось вступить в бригаду',
                  message: teamJoinErrorMessage(e),
                  primaryLabel: 'Понятно',
                  onPrimary: () => undefined,
                });
                return;
              }
              try {
                await syncProjectSideEffects({ user, project: activeProject });
              } catch (syncError) {
                // членство уже создано; обновление данных догонит следующий refresh
                reportError('teamQr.syncAfterJoin', syncError, { userId: user.id });
              }
              joiningRef.current = false;
              // W130: бригада → главная / график
              alertTeamJoined('contractor');
              router.back();
            }}
          />
        ) : null}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background },
  h: { fontWeight: '800', fontSize: 16, marginBottom: 4 },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18, marginBottom: 12 },
  roles: { gap: 8, marginBottom: 14 },
  roleChip: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: RenovaTheme.colors.surface,
  },
  roleOn: { borderColor: RenovaTheme.colors.primary, backgroundColor: '#EFF6FF' },
  roleT: { fontWeight: '700', color: RenovaTheme.colors.text },
  roleTOn: { color: RenovaTheme.colors.primary },
  roleHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  link: { fontSize: 12, marginBottom: 12, color: RenovaTheme.colors.textMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  cam: { height: 240, marginTop: 12, borderRadius: 12, overflow: 'hidden' },
});
