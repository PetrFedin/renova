/** Диплинк renova://team/join/<token> — приглашение в бригаду (ROLE-009). */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { reportError } from '@/lib/reportError';
import { useRenova } from '@/lib/context/RenovaContext';
import { alertTeamJoined } from '@/lib/jobLeadNav';
import { requireSuccessfulTeamJoin, teamJoinErrorMessage } from '@/lib/teamJoinFlow';

export default function TeamJoinLinkScreen() {
  const { token: rawToken } = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const { user, loading, refreshMe } = useRenova();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;
    if (!token) {
      setError('В ссылке нет приглашения');
      return;
    }
    started.current = true;
    if (!user) {
      // Нет сессии: онбординг сам вступит в бригаду после входа исполнителя.
      router.replace({ pathname: '/onboarding/[step]', params: { step: 'role', teamToken: token } });
      return;
    }
    if (user.role !== 'contractor') {
      setError('Приглашение в бригаду действует только для исполнителей. Войдите под аккаунтом исполнителя.');
      return;
    }
    (async () => {
      try {
        requireSuccessfulTeamJoin(await api.joinTeam(user.id, token));
        try {
          await refreshMe();
        } catch (refreshError) {
          // членство уже создано; повторно токен не расходуем
          reportError('teamJoinLink.refreshMe', refreshError, { userId: user.id });
        }
        alertTeamJoined('contractor');
      } catch (e: unknown) {
        setError(teamJoinErrorMessage(e));
      }
    })();
  }, [loading, user, token, refreshMe]);

  if (error) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>Не удалось вступить в бригаду</Text>
        <Text style={s.text}>{error}</Text>
        <PrimaryButton title="На главную" onPress={() => router.replace('/')} />
      </View>
    );
  }
  return (
    <View style={s.wrap}>
      <ActivityIndicator />
      <Text style={s.text}>Проверяем приглашение…</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 24, gap: 12, justifyContent: 'center', backgroundColor: RenovaTheme.colors.background },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  text: { textAlign: 'center', color: RenovaTheme.colors.textMuted, lineHeight: 20 },
});
