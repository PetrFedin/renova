/** P2.1 Web client portal — read-only по magic link ?token= */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable, Linking, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { api } from '@/lib/api';

const PORTAL_USER_KEY = 'renova:portal:user';

export default function PortalScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<{ user_id: string; project_id: string; project_name: string; scopes?: string[]; read_only?: boolean } | null>(null);
  const [portalToken, setPortalToken] = useState('');
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof api.portalSnapshot>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tok = typeof token === 'string' ? token : '';
        if (!tok) {
          Alert.alert('Портал', 'Нужна ссылка с token');
          return;
        }
        setPortalToken(tok);
        const sess = await api.exchangePortalToken(tok);
        await AsyncStorage.setItem(PORTAL_USER_KEY, sess.user_id);
        if (cancelled) return;
        setSession(sess);
        const snap = await api.portalSnapshot(sess.user_id, sess.project_id);
        if (!cancelled) setSnapshot(snap);
      } catch {
        if (!cancelled) Alert.alert('Портал', 'Ссылка недействительна или истекла');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={RenovaTheme.colors.primary} />
        <Text style={s.muted}>Открываем портал…</Text>
      </View>
    );
  }

  if (!session || !snapshot) {
    return (
      <View style={s.center}>
        <Text style={s.title}>Портал Renova</Text>
        <Text style={s.muted}>Не удалось загрузить объект</Text>
      </View>
    );
  }

  const sched = snapshot.schedule as { current_stage?: string; progress_percent?: number; planned_end?: string };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      <Text style={s.brand}>Renova · портал заказчика</Text>
      <Text style={s.title}>{snapshot.project.name}</Text>
      {snapshot.project.address ? <Text style={s.muted}>{snapshot.project.address}</Text> : null}
      <Text style={s.ro}>{session.scopes?.includes('accept_stage') ? 'Портал заказчика · приёмка и оплата' : 'Только просмотр'} · {session.project_name}</Text>

      {(snapshot.pending_acceptances?.length ?? 0) > 0 && (session.scopes?.includes('accept_stage') || snapshot.can_accept_stage) && !session.read_only ? (
        <View style={s.card}>
          <Text style={s.cardHead}>Приёмка этапов</Text>
          {snapshot.pending_acceptances!.map((acc) => (
            <View key={acc.id} style={s.acceptRow}>
              <Text style={s.line}>{acc.stage_name || 'Этап'} · ждёт решения</Text>
              <Pressable
                style={s.acceptBtn}
                onPress={async () => {
                  try {
                    await api.portalAcceptStage(session.project_id, acc.id, portalToken);
                    const snap = await api.portalSnapshot(session.user_id, session.project_id);
                    setSnapshot(snap);
                    Alert.alert('Принято', `Этап «${acc.stage_name || 'работы'}» принят`);
                  } catch {
                    Alert.alert('Ошибка', 'Не удалось принять этап');
                  }
                }}
              >
                <Text style={s.acceptBtnT}>Принять этап</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.cardHead}>Расписание</Text>
        <Text style={s.line}>Этап: {sched.current_stage || '—'}</Text>
        <Text style={s.line}>Прогресс: {sched.progress_percent ?? snapshot.project.progress_percent ?? 0}%</Text>
        {sched.planned_end ? <Text style={s.line}>План окончания: {sched.planned_end}</Text> : null}
      </View>

      <View style={s.card}>
        <Text style={s.cardHead}>Ожидают оплаты ({snapshot.pending_payments.length})</Text>
        {snapshot.pending_payments.length === 0 ? (
          <Text style={s.muted}>Нет счетов</Text>
        ) : (
          snapshot.pending_payments.map((pay) => {
            const requisites = [
              'Получатель: исполнитель по договору',
              'Сбербанк · карта 2202 2065 •••• 4521',
              `Сумма: ${formatRub(pay.amount)}`,
              `Назначение: ${pay.title}`,
            ].join('\n');
            return (
              <View key={pay.id} style={s.payRow}>
                <Text style={s.line}>{pay.title} · {formatRub(pay.amount)}</Text>
                <View style={s.payActions}>
                  <Pressable
                    style={s.payBtn}
                    onPress={async () => {
                      try {
                        const checkout = await api.checkoutYookassa(session.user_id, session.project_id, pay.id);
                        if (checkout.demo) {
                          const snap = await api.portalSnapshot(session.user_id, session.project_id);
                          setSnapshot(snap);
                          Alert.alert('Оплата', checkout.message || 'Оплата подтверждена (demo ЮKassa).');
                          return;
                        }
                        if (checkout.confirmation_url) {
                          await WebBrowser.openBrowserAsync(checkout.confirmation_url);
                          Alert.alert('ЮKassa', 'После оплаты обновите страницу портала.');
                        }
                      } catch {
                        Alert.alert('ЮKassa', 'Оплата картой недоступна. Используйте перевод по реквизитам.');
                      }
                    }}
                  >
                    <Text style={s.payBtnT}>Оплатить картой</Text>
                  </Pressable>
                  <Pressable
                    style={s.payBtnOutline}
                    onPress={async () => {
                      try { await Clipboard.setStringAsync(String(Math.round(pay.amount))); } catch { /* noop */ }
                      Alert.alert(
                        'Перевод',
                        `${requisites}\n\nСумма скопирована. Откройте банк или СБП.`,
                        Platform.OS === 'web'
                          ? [{ text: 'OK' }]
                          : [{ text: 'OK' }, { text: 'Открыть банк', onPress: () => Linking.openURL('bank100000000001://').catch(() => {}) }],
                      );
                    }}
                  >
                    <Text style={s.payBtnOutlineT}>Реквизиты / СБП</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </View>


      <View style={s.card}>
        <Text style={s.cardHead}>Подбор материалов ({snapshot.selections_total})</Text>
        {snapshot.selections.length === 0 ? (
          <Text style={s.muted}>Нет позиций</Text>
        ) : (
          snapshot.selections.slice(0, 6).map((sel) => (
            <Text key={sel.id} style={s.line}>{sel.title} · {sel.status}</Text>
          ))
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardHead}>Документы ({snapshot.documents_total})</Text>
        {snapshot.documents.filter((d) => d.status === 'draft').length > 0 ? (
          <View style={s.draftBlock}>
            <Text style={s.draftHead}>Ожидают подписи</Text>
            {snapshot.documents.filter((d) => d.status === 'draft').map((d) => (
              <View key={d.id} style={s.acceptRow}>
                <Text style={s.line}>{d.title} · черновик</Text>
                {(session.scopes?.includes('sign_document') || snapshot.can_sign_documents) && !session.read_only ? (
                  <Pressable
                    style={s.acceptBtn}
                    onPress={async () => {
                      try {
                        const res = await api.portalSignDocument(session.project_id, d.id, portalToken, 'in_app');
                        const snap = await api.portalSnapshot(session.user_id, session.project_id);
                        setSnapshot(snap);
                        Alert.alert('Подписано', res.status === 'signed' ? d.title : 'Запрос на подпись создан');
                      } catch {
                        Alert.alert('Ошибка', 'Не удалось подписать документ');
                      }
                    }}
                  >
                    <Text style={s.acceptBtnT}>Подписать</Text>
                  </Pressable>
                ) : null}
                {(session.scopes?.includes('sign_document') || snapshot.can_sign_documents) && !session.read_only ? (
                  <Pressable
                    style={s.konturBtn}
                    onPress={async () => {
                      try {
                        const res = await api.portalSignDocument(session.project_id, d.id, portalToken, 'kontur');
                        if (res.signing_url) {
                          await Linking.openURL(res.signing_url);
                          Alert.alert('Контур', 'Завершите подпись в браузере. Статус обновится по webhook.');
                        } else {
                          Alert.alert('Контур', 'Запрос создан. Статус обновится позже.');
                        }
                        const snap = await api.portalSnapshot(session.user_id, session.project_id);
                        setSnapshot(snap);
                      } catch {
                        Alert.alert('Контур', 'Не удалось открыть подпись');
                      }
                    }}
                  >
                    <Text style={s.konturBtnT}>Контур</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            <Text style={s.muted}>Подпишите в приложении Renova → Документы проекта</Text>
          </View>
        ) : null}
        {snapshot.documents.slice(0, 8).map((d) => (
          <Text key={d.id} style={s.line}>{d.title}{d.status === 'draft' ? ' · черновик' : ''}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  brand: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.primary, textTransform: 'uppercase' },
  title: { fontSize: 24, fontWeight: '800', color: RenovaTheme.colors.text },
  muted: { fontSize: 14, color: RenovaTheme.colors.textMuted },
  ro: { fontSize: 12, color: RenovaTheme.colors.warning, fontWeight: '600', marginBottom: 8 },
  card: { ...card, gap: 6 },
  cardHead: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  line: { fontSize: 14, color: RenovaTheme.colors.text },
  acceptRow: { gap: 8, marginBottom: 8 },
  acceptBtn: { alignSelf: 'flex-start', backgroundColor: RenovaTheme.colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  acceptBtnT: { color: RenovaTheme.colors.surface, fontWeight: '700', fontSize: 13 },
  konturBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: RenovaTheme.colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  konturBtnT: { color: RenovaTheme.colors.primary, fontWeight: '700', fontSize: 12 },
});
