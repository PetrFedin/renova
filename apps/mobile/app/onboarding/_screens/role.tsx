import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput } from 'react-native';
import { alertMessage } from '@/lib/confirmAlert';
import { useLocalSearchParams } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { UserRole } from '@/lib/api';
import { api } from '@/lib/api';
import { navigateAfterLogin } from '@/lib/osEntry';
import { reportError } from '@/lib/reportError';
import { requireSuccessfulTeamJoin } from '@/lib/teamJoinFlow';

type Mode = 'demo' | 'sms';

/** W67 #27: демо-вход только при явном EXPO_PUBLIC_DEMO=1 (fail-closed по умолчанию). */
const DEMO_LOGIN_ENABLED = (process.env.EXPO_PUBLIC_DEMO ?? '0') === '1';

export default function RoleScreen() {
  const { teamToken } = useLocalSearchParams<{ teamToken?: string }>();
  const { demoLogin, loginWithSms, refreshMe } = useRenova();
  const [mode, setMode] = useState<Mode>(DEMO_LOGIN_ENABLED ? 'demo' : 'sms');
  const [role, setRole] = useState<UserRole>('customer');
  const [phone, setPhone] = useState('+79001234567');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTeamJoinUserId, setPendingTeamJoinUserId] = useState<string | null>(null);
  const teamJoinPending = Boolean(teamToken && role === 'contractor' && pendingTeamJoinUserId);

  async function afterLogin(existingUserId?: string) {
    if (teamToken && role === 'contractor') {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      const id = existingUserId ?? await AsyncStorage.getItem('renova_user_id');
      if (!id) throw new Error('Не удалось подтвердить сессию для вступления в бригаду');

      // Authentication is already committed. Keep the user id locally so a failed
      // join can be retried without re-running demo login or consuming another OTP.
      setPendingTeamJoinUserId(id);
      let teamId: string;
      try {
        const joined = await api.joinTeam(id, teamToken);
        teamId = requireSuccessfulTeamJoin(joined);
      } catch (joinError) {
        reportError('onboarding.teamJoin', joinError, { userId: id, role });
        throw joinError;
      }

      // Membership is committed at this point. A refresh failure is reconciliation
      // debt, not a failed join; never ask the user to consume the single-use token again.
      setPendingTeamJoinUserId(null);
      try {
        await refreshMe();
      } catch (refreshError) {
        reportError('onboarding.teamJoin.refreshAccess', refreshError, { userId: id, teamId });
      }
    }
    await navigateAfterLogin(role);
  }

  async function onContinue() {
    setBusy(true);
    setError(null);
    try {
      if (teamJoinPending && pendingTeamJoinUserId) {
        await afterLogin(pendingTeamJoinUserId);
        return;
      }

      if (mode === 'demo') {
        if (!DEMO_LOGIN_ENABLED) throw new Error('demo_login_disabled');
        await demoLogin(role);
      } else {
        if (!codeSent) {
          const r = await api.sendSmsCode(phone);
          setCodeSent(true);
          if (r.demo_code) setDemoCode(r.demo_code);
          alertMessage('Код отправлен', r.demo_code ? `Демо-код: ${r.demo_code}` : 'Проверьте SMS');
          return;
        }
        await loginWithSms(phone, code, role, name ? { full_name: name } : undefined);
      }
      await afterLogin();
    } catch (e: any) {
      const msg = e?.message || 'Сервер недоступен';
      setError(msg);
      alertMessage(teamJoinPending ? 'Не удалось вступить в бригаду' : 'Ошибка входа', msg);
    } finally {
      setBusy(false);
    }
  }

  async function continueWithoutTeam() {
    setBusy(true);
    setError(null);
    try {
      await navigateAfterLogin(role);
    } catch (e: any) {
      const msg = e?.message || 'Не удалось продолжить';
      setError(msg);
      alertMessage('Ошибка перехода', msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.logo}>Renova</Text>
      <Text style={styles.sub}>Кто вы в этом проекте?</Text>
      <View style={styles.modeRow}>
        {(DEMO_LOGIN_ENABLED ? (['demo', 'sms'] as Mode[]) : (['sms'] as Mode[])).map((m) => (
          <Pressable
            key={m}
            disabled={teamJoinPending}
            style={[styles.modeBtn, mode === m && styles.modeOn, teamJoinPending && styles.controlDisabled]}
            onPress={() => { setMode(m); setCodeSent(false); }}
          >
            <Text style={[styles.modeT, mode === m && styles.modeTOn]}>{m === 'demo' ? 'Демо-стенд' : 'SMS'}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'demo' ? (
        <Text style={{ color: RenovaTheme.colors.textMuted, fontSize: 13, marginBottom: 8 }}>
          Демо-вход создаёт учебные данные. Для пилота используйте SMS.
        </Text>
      ) : null}
      <View style={styles.roles}>
        {(['customer', 'contractor'] as UserRole[]).map((r) => (
          <Pressable
            key={r}
            disabled={teamJoinPending}
            style={[styles.roleBtn, role === r && styles.roleActive, teamJoinPending && styles.controlDisabled]}
            onPress={() => setRole(r)}
          >
            <Text style={[styles.roleText, role === r && styles.roleTextActive]}>{r === 'customer' ? 'Заказчик' : 'Исполнитель'}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'sms' && (
        <>
          <TextInput style={styles.input} placeholder="Телефон +7…" value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!teamJoinPending} />
          {codeSent && <TextInput style={styles.input} placeholder="Код из SMS" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} editable={!teamJoinPending} />}
          <TextInput style={styles.input} placeholder="Имя (необязательно)" value={name} onChangeText={setName} editable={!teamJoinPending} />
          {demoCode && <Text style={styles.demoCode}>Демо-код: {demoCode}</Text>}
        </>
      )}
      {teamJoinPending ? (
        <Text style={styles.joinNotice}>
          Вход уже выполнен. Не удалось подтвердить вступление в бригаду — можно повторить только этот шаг или продолжить без вступления.
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        title={teamJoinPending ? 'Повторить вступление' : mode === 'sms' && !codeSent ? 'Отправить код' : 'Продолжить'}
        onPress={onContinue}
        loading={busy}
      />
      {teamJoinPending ? (
        <Pressable disabled={busy} style={styles.skipJoin} onPress={() => { void continueWithoutTeam(); }}>
          <Text style={styles.skipJoinText}>Продолжить без вступления</Text>
        </Pressable>
      ) : null}
      <Text style={styles.note}>{mode === 'demo' ? 'Демо без регистрации' : 'SMS — для пилота с реальными бригадами'}</Text>
      <Text style={styles.noteHint}>После входа: «Ещё» → «← Выбор роли»</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { flexGrow: 1, padding: 20, justifyContent: 'center', minHeight: '100%' as unknown as number },
  logo: { fontSize: 32, fontWeight: '800', color: RenovaTheme.colors.primary, textAlign: 'center' },
  sub: { textAlign: 'center', color: RenovaTheme.colors.textMuted, marginBottom: 16, marginTop: 6, fontSize: 15 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: RenovaTheme.colors.border, alignItems: 'center' },
  modeOn: { backgroundColor: RenovaTheme.colors.primary },
  modeT: { fontWeight: '700', color: '#333' },
  modeTOn: { color: RenovaTheme.colors.surface },
  roles: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  roleBtn: { flex: 1, paddingVertical: 16, borderRadius: 12, borderWidth: 2, borderColor: RenovaTheme.colors.border, backgroundColor: RenovaTheme.colors.surface, alignItems: 'center' },
  roleActive: { borderColor: RenovaTheme.colors.primary, backgroundColor: RenovaTheme.colors.infoBg },
  roleText: { fontWeight: '700', fontSize: 14, textAlign: 'center' },
  roleTextActive: { color: RenovaTheme.colors.primary },
  controlDisabled: { opacity: 0.55 },
  input: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: RenovaTheme.colors.surface },
  demoCode: { textAlign: 'center', color: RenovaTheme.colors.primary, fontWeight: '600', marginBottom: 8 },
  joinNotice: { fontSize: 12, color: RenovaTheme.colors.textMuted, textAlign: 'center', marginBottom: 10, lineHeight: 18 },
  skipJoin: { paddingVertical: 12, alignItems: 'center' },
  skipJoinText: { color: RenovaTheme.colors.textMuted, fontWeight: '600', fontSize: 13 },
  note: { textAlign: 'center', fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 16, lineHeight: 18 },
  noteHint: { fontSize: 11, color: '#94a3b8', marginTop: 6, textAlign: 'center', lineHeight: 16 },
  error: { color: RenovaTheme.colors.dangerText, fontSize: 13, textAlign: 'center', marginBottom: 10, lineHeight: 18 },
});
