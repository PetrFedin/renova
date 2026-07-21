import { BackHeader } from '@/components/renova/BackHeader';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Share, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { pushOsNav } from '@/lib/pushOsNav';
import { alertTeamJoined } from '@/lib/jobLeadNav';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';
import { QrCodeImage } from '@/components/renova/QrCodeImage';

const ROLES = [
  { id: 'member', label: 'Рабочий', hint: 'Этапы, чеки, снабжение' },
  { id: 'foreman', label: 'Прораб', hint: 'Координация на объекте' },
  { id: 'viewer', label: 'Наблюдатель', hint: 'Только просмотр' },
] as const;

type RoleId = (typeof ROLES)[number]['id'];

export default function TeamQrScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { activeProject, user } = useRenova();
  const [perm, req] = useCameraPermissions();
  const [role, setRole] = useState<RoleId>('member');
  const [link, setLink] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshLink = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const l = await api.createTeamInviteLink(user.id, role);
      setLink(l.link);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Создайте бригаду в профиле';
      // W67 #35
      Alert.alert(
        'Бригада',
        /402|pro|подписк/i.test(msg)
          ? 'QR бригады доступен на Pro. Откройте «Подписка» или используйте staging с trial.'
          : msg,
        /402|pro|подписк/i.test(msg)
          ? [
              { text: 'OK', style: 'cancel' },
              { text: 'Подписка', onPress: () => pushOsNav('/(contractor)/subscription', undefined, 'contractor') },
            ]
          : undefined,
      );
    } finally {
      setBusy(false);
    }
  }, [user?.id, role]);

  useEffect(() => {
    void refreshLink();
  }, [refreshLink]);

  return (
    <>
      <BackHeader title="Бригада QR" returnTo={returnTo} />
      <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={s.h}>Роль по ссылке</Text>
        <Text style={s.sub}>Сканирует новый исполнитель → входит в вашу бригаду с выбранной ролью (H1.5). На staging без Pro invite может быть недоступен — см. подписку.</Text>
        <View style={s.roles}>
          {ROLES.map((r) => (
            <Pressable key={r.id} onPress={() => setRole(r.id)} style={[s.roleChip, role === r.id && s.roleOn]}>
              <Text style={[s.roleT, role === r.id && s.roleTOn]}>{r.label}</Text>
              <Text style={s.roleHint}>{r.hint}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.link} selectable>
          {link || (busy ? 'Генерируем…' : '—')}
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
              Alert.alert('Скопировано', 'Отправьте ссылку в WhatsApp / Telegram');
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
        <PrimaryButton title="Обновить QR" variant="outline" disabled={busy} onPress={refreshLink} />

        <PrimaryButton title={scan ? 'Стоп сканер' : 'Сканировать invite'} onPress={() => setScan(!scan)} />
        {!perm?.granted && scan ? <PrimaryButton title="Разрешить камеру" onPress={req} /> : null}
        {scan && perm?.granted ? (
          <CameraView
            style={s.cam}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={async ({ data }) => {
              const m = data.match(/join\/([^/?]+)/);
              if (!m || !user) return;
              setScan(false);
              await api.joinTeam(user.id, m[1]);
              await syncProjectSideEffects({ user, project: activeProject });
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
