/** W72: branded client portal (magic link) — решения без обязательной оплаты */
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable, Linking, Platform, AppState, Share } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { buildPaymentRequisites } from '@/lib/paymentRequisites';
import { api, ApiError } from '@/lib/api';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { apiErrorMessage } from '@/lib/formatPhone';

const PORTAL_USER_KEY = 'renova:portal:user';

export default function PortalScreen() {
  const { token, paid, paymentId } = useLocalSearchParams<{ token?: string; paid?: string; paymentId?: string }>();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<{ user_id: string; project_id: string; project_name: string; scopes?: string[]; read_only?: boolean } | null>(null);
  const [portalToken, setPortalToken] = useState('');
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof api.portalSnapshot>> | null>(null);
  const [focusSection, setFocusSection] = useState<'payments' | 'docs' | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const paymentsY = useRef(0);
  const docsY = useRef(0);

  /** W85: snapshot + inbox/home side-effects (если заказчик открыл портал и приложение) */
  const refreshPortalSnapshot = async (userId: string, projectId: string) => {
    let snap: Awaited<ReturnType<typeof api.portalSnapshot>> | null = null;
    try {
      snap = await api.portalSnapshot(userId, projectId);
      setSnapshot(snap);
    } catch { /* best-effort */ }
    await syncProjectSideEffects({
      user: { id: userId, role: 'customer' } as any,
      project: { id: projectId } as any,
      role: 'customer',
    });
    return snap;
  };

  const goPayments = () => {
    setFocusSection('payments');
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, paymentsY.current - 12), animated: true });
    });
  };
  const goDocs = () => {
    setFocusSection('docs');
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, docsY.current - 12), animated: true });
    });
  };

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
        if (!cancelled && paid === '1') {
          Alert.alert('Оплата', paymentId ? `Платёж ${paymentId} обрабатывается` : 'Спасибо! Статус обновлён.');
        }
      } catch {
        if (!cancelled) Alert.alert('Портал', 'Ссылка недействительна или истекла');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, paid, paymentId]);

  useEffect(() => {
    if (!session) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPortalSnapshot(session.user_id, session.project_id);
    });
    return () => sub.remove();
  }, [session?.user_id, session?.project_id]);

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

  const portalReadOnly = session.read_only || snapshot.read_only;
  // Честность scopes: не выводить оплату/приёмку/подпись из «есть pending» без явного права в токене
  const canPayPortal = !portalReadOnly && Boolean(session.scopes?.includes('pay'));
  const canAcceptPortal = !portalReadOnly && Boolean(session.scopes?.includes('accept_stage'));
  const canSignPortal = !portalReadOnly && Boolean(session.scopes?.includes('sign_document'));
  // W105: snapshot can_* согласовать со scopes токена (не показывать CTA без права)
  const canConfirmSchedule = Boolean(snapshot.can_confirm_schedule) && canAcceptPortal;
  const canAcceptStageSnap = Boolean(snapshot.can_accept_stage) && canAcceptPortal;
  const canSignDocsSnap = Boolean(snapshot.can_sign_documents) && canSignPortal;


  const progress = sched.progress_percent ?? snapshot.project.progress_percent ?? 0;
  const todoBits = [
    (snapshot.pending_acceptances?.length ?? 0) > 0 ? `приёмка ${snapshot.pending_acceptances!.length}` : null,
    snapshot.pending_payments.length > 0 ? `оплата ${snapshot.pending_payments.length}` : null,
    (snapshot.pending_draft_documents?.length ?? 0) > 0 ? `подпись ${snapshot.pending_draft_documents!.length}` : null,
  ].filter(Boolean);

  return (
    <ScrollView ref={scrollRef} style={s.wrap} contentContainerStyle={s.content}>
      <View style={s.hero}>
        <Text style={s.brand}>RENOVA</Text>
        <Text style={s.brandSub}>Портал заказчика</Text>
        <Text style={s.title}>{snapshot.project.name}</Text>
        {snapshot.project.address ? <Text style={s.muted}>{snapshot.project.address}</Text> : null}
        {snapshot.contractor_company_name || snapshot.contractor_recipient_name ? (
          <Text style={s.muted}>
            Исполнитель · {snapshot.contractor_company_name || snapshot.contractor_recipient_name}
          </Text>
        ) : null}
        <Text style={s.progressLine}>Прогресс · {progress}%</Text>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${Math.min(100, Math.max(0, Number(progress)))}%` }]} />
        </View>
        {todoBits.length ? (
          <Text style={s.todoLine}>Сейчас: {todoBits.join(' · ')}</Text>
        ) : (
          <Text style={s.todoLine}>Нет срочных действий</Text>
        )}
        <Pressable
          style={s.shareBtn}
          onPress={async () => {
            const docs = (snapshot.documents_total ?? snapshot.documents?.length ?? 0);
            const msg = [
              `Renova · ${snapshot.project.name}`,
              snapshot.project.address || '',
              `Прогресс ${progress}%`,
              snapshot.contractor_company_name ? `Исполнитель: ${snapshot.contractor_company_name}` : '',
              todoBits.length ? `Сейчас: ${todoBits.join(', ')}` : 'Срочных действий нет',
              `Документов: ${docs}`,
              'Статус из портала заказчика (без оплаты).',
            ].filter(Boolean).join('\n');
            try {
              await Share.share({ message: msg, title: snapshot.project.name });
            } catch {
              await Clipboard.setStringAsync(msg);
              Alert.alert('Скопировано', 'Статус объекта в буфере — можно отправить семье');
            }
          }}
        >
          <Text style={s.shareBtnT}>Поделиться статусом с семьёй</Text>
        </Pressable>
        <Text style={s.ro}>
          {portalReadOnly
            ? 'Только просмотр'
            : ['Приёмка', canSignPortal ? 'Подпись' : null, canPayPortal ? 'Оплата' : null]
                .filter(Boolean)
                .join(' · ') || 'Решения по объекту'}
          {' · '}
          {session.project_name}
        </Text>
      </View>

      {snapshot.pending_work_schedule ? (
        <View style={s.card}>
          <Text style={s.cardHead}>План-график</Text>
          <Text style={s.line}>{snapshot.pending_work_schedule.title || 'График работ'} · на согласовании</Text>
          {canConfirmSchedule ? (
            <View style={s.payActions}>
              <Pressable
                style={s.acceptBtn}
                onPress={async () => {
                  try {
                    await api.portalConfirmSchedule(
                      session.user_id,
                      session.project_id,
                      snapshot.pending_work_schedule.id,
                      portalToken,
                    );
                    await refreshPortalSnapshot(session.user_id, session.project_id);
                    Alert.alert('График', 'План-график согласован');
                  } catch (e) {
                    Alert.alert('График', apiErrorMessage(e, 'Не удалось подтвердить'));
                  }
                }}
              >
                <Text style={s.acceptBtnT}>Согласовать график</Text>
              </Pressable>
              <Pressable
                style={s.payBtnOutline}
                onPress={async () => {
                  try {
                    await api.portalRejectSchedule(
                      session.user_id,
                      session.project_id,
                      snapshot.pending_work_schedule.id,
                      portalToken,
                      'Нужна правка сроков',
                    );
                    await refreshPortalSnapshot(session.user_id, session.project_id);
                    Alert.alert('График', 'План отклонён — исполнитель получит задачу на правку');
                  } catch (e) {
                    Alert.alert('График', apiErrorMessage(e, 'Не удалось отклонить'));
                  }
                }}
              >
                <Text style={s.payBtnOutlineT}>Отклонить</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={s.muted}>Ожидает подтверждения заказчиком в приложении Renova</Text>
          )}
        </View>
      ) : null}

{(snapshot.pending_acceptances?.length ?? 0) > 0 && canAcceptStageSnap ? (
        <View style={s.card}>
          <Text style={s.cardHead}>Приёмка этапов</Text>
          {snapshot.pending_acceptances!.map((acc) => (
            <View key={acc.id} style={s.acceptRow}>
              <Text style={s.line}>{acc.stage_name || 'Этап'} · ждёт решения{acc.hours_waiting != null ? ` · ${acc.hours_waiting} ч` : ''}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Pressable
                  style={s.acceptBtn}
                  onPress={async () => {
                    try {
                      await api.portalAcceptStage(session.project_id, acc.id, portalToken);
                      // W122: после приёмки — актуальный snapshot + CTA к оплате (BT chain)
                      const next = await refreshPortalSnapshot(session.user_id, session.project_id);
                      const payN = next?.pending_payments?.length ?? 0;
                      const docN = next?.pending_draft_documents?.length ?? next?.documents?.filter((d) => d.status === 'draft')?.length ?? 0;
                      Alert.alert(
                        'Этап принят',
                        payN
                          ? `«${acc.stage_name || 'работы'}» принят. Доступно счетов: ${payN}.`
                          : docN
                            ? `«${acc.stage_name || 'работы'}» принят. Есть документы на подпись.`
                            : `«${acc.stage_name || 'работы'}» принят.`,
                        [
                          { text: 'OK', style: 'cancel' },
                          ...(payN && canPayPortal ? [{ text: 'К оплате', onPress: goPayments }] : []),
                          ...(!payN && docN && canSignPortal ? [{ text: 'К подписи', onPress: goDocs }] : []),
                        ],
                      );
                    } catch {
                      Alert.alert('Ошибка', 'Не удалось принять этап');
                    }
                  }}
                >
                  <Text style={s.acceptBtnT}>Принять этап</Text>
                </Pressable>
                <Pressable
                  style={[s.acceptBtn, { backgroundColor: RenovaTheme.colors.border }]}
                  onPress={async () => {
                    try {
                      await api.portalReturnStage(session.project_id, acc.id, portalToken, 'Нужна доработка');
                      await refreshPortalSnapshot(session.user_id, session.project_id);
                      Alert.alert('Возвращено', `«${acc.stage_name || 'работы'}» отправлены на доработку`);
                    } catch {
                      Alert.alert('Ошибка', 'Не удалось вернуть этап');
                    }
                  }}
                >
                  <Text style={[s.acceptBtnT, { color: RenovaTheme.colors.text }]}>На доработку</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {snapshot.estimate_summary ? (
        <View style={s.card}>
          <Text style={s.cardHead}>Смета</Text>
          <Text style={s.line}>
            {snapshot.estimate_summary.lines_count} поз. · {snapshot.estimate_summary.total?.toLocaleString?.('ru-RU') || snapshot.estimate_summary.total} ₽
          </Text>
          <Text style={s.muted}>
            {snapshot.estimate_summary.locked_at
              ? `Зафиксирована ${snapshot.estimate_summary.locked_at.slice(0, 10)}`
              : snapshot.estimate_summary.proposed_at
                ? 'На согласовании — можно зафиксировать'
                : 'Черновик (ждём отправку от исполнителя)'}
          </Text>
          {(snapshot.estimate_summary?.lines || []).slice(0, 5).map((ln, i) => (
            <Text key={i} style={s.muted}>{ln.name} · {ln.total} ₽</Text>
          ))}
          {/* W105: lock/reject по magic link (тот же scope, что приёмка) */}
          {canAcceptPortal && snapshot.estimate_summary.proposed_at && !snapshot.estimate_summary.locked_at ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Pressable
                style={s.acceptBtn}
                onPress={async () => {
                  try {
                    await api.portalLockEstimate(session.project_id, portalToken);
                    setSnapshot(await api.portalSnapshot(session.user_id, session.project_id));
                    Alert.alert('Готово', 'Смета зафиксирована');
                  } catch {
                    Alert.alert('Ошибка', 'Не удалось зафиксировать смету');
                  }
                }}
              >
                <Text style={s.acceptBtnT}>Зафиксировать смету</Text>
              </Pressable>
              <Pressable
                style={[s.acceptBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: RenovaTheme.colors.border }]}
                onPress={async () => {
                  try {
                    await api.portalRejectEstimate(session.project_id, portalToken, 'Нужна правка сметы');
                    setSnapshot(await api.portalSnapshot(session.user_id, session.project_id));
                    Alert.alert('Отклонено', 'Исполнитель получит уведомление');
                  } catch {
                    Alert.alert('Ошибка', 'Не удалось отклонить');
                  }
                }}
              >
                <Text style={[s.acceptBtnT, { color: RenovaTheme.colors.text }]}>Отклонить</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.cardHead}>Расписание</Text>
        <Text style={s.line}>Этап: {sched.current_stage || '—'}</Text>
        <Text style={s.line}>Прогресс: {sched.progress_percent ?? snapshot.project.progress_percent ?? 0}%</Text>
        {sched.planned_end ? <Text style={s.line}>План окончания: {sched.planned_end}</Text> : null}
      </View>

      <View
        style={[s.card, focusSection === 'payments' && s.focusCard]}
        onLayout={(e) => { paymentsY.current = e.nativeEvent.layout.y; }}
      >
        <Text style={s.cardHead}>Ожидают оплаты ({snapshot.pending_payments.length})</Text>
        <Text style={s.muted}>
          {snapshot.payments_mode === 'live'
            ? 'Оплата картой: ЮKassa live'
            : snapshot.payments_mode === 'requisites'
              ? 'Оплата: перевод по реквизитам (карта недоступна)'
              : snapshot.payments_mode === 'off'
                ? 'Оплата картой недоступна на этом сервере. Используйте реквизиты или полное приложение.'
                : 'Оплата: demo / укажите реквизиты исполнителя'}
        </Text>
        {portalReadOnly ? (
          <Text style={s.muted}>Оплата недоступна в режиме просмотра. Откройте полное приложение Renova.</Text>
        ) : snapshot.pending_payments.length === 0 ? (
          <Text style={s.muted}>Нет счетов</Text>
        ) : (
          snapshot.pending_payments.map((pay) => {
            const built = buildPaymentRequisites({
              recipientName: snapshot.contractor_recipient_name,
              paymentRequisites: snapshot.contractor_payment_requisites,
              amount: pay.amount,
              title: pay.title,
            });
            const requisites = built.text;
            return (
              <View key={pay.id} style={s.payRow}>
                <Text style={s.line}>{pay.title} · {formatRub(pay.amount)}</Text>
                {canPayPortal ? (
                <View style={s.payActions}>
                  {(snapshot.payments_mode === 'live' || snapshot.payments_mode === 'demo') ? (
                  <Pressable
                    style={s.payBtn}
                    onPress={async () => {
                      try {
                        const checkout = await api.checkoutYookassa(session.user_id, session.project_id, pay.id, { portal_token: portalToken });
                        if (checkout.demo) {
                          await refreshPortalSnapshot(session.user_id, session.project_id);
                          Alert.alert('Оплата (demo)', checkout.message || 'Тестовая оплата без реального списания. Для prod настройте YOOKASSA_* на сервере.');
                          return;
                        }
                        if (checkout.confirmation_url) {
                          await WebBrowser.openBrowserAsync(checkout.confirmation_url);
                          await refreshPortalSnapshot(session.user_id, session.project_id);
                          Alert.alert('ЮKassa', 'Статус оплаты обновлён. Если платёж не отображается — подождите минуту.');
                        }
                      } catch (e) {
                        const msg = apiErrorMessage(e, 'Оплата картой недоступна. Используйте перевод по реквизитам.');
                        Alert.alert('ЮKassa', msg);
                      }
                    }}
                  >
                    <Text style={s.payBtnT}>
                      {snapshot.payments_mode === 'live' ? 'Оплатить картой' : 'Карта (demo)'}
                    </Text>
                  </Pressable>
                  ) : null}
                  <Pressable
                    style={s.payBtnOutline}
                    onPress={async () => {
                      if (built.missingHint) {
                        Alert.alert('Реквизиты не указаны', built.missingHint);
                        return;
                      }
                      try { await Clipboard.setStringAsync(requisites); } catch { /* noop */ }
                      Alert.alert(
                        'Перевод',
                        `${requisites}\n\nРеквизиты скопированы. Откройте банк или СБП.`,
                        Platform.OS === 'web'
                          ? [{ text: 'OK' }]
                          : [{ text: 'OK' }, { text: 'Готово', onPress: () => {} }],
                      );
                    }}
                  >
                    <Text style={s.payBtnOutlineT}>Реквизиты / СБП</Text>
                  </Pressable>
                </View>
                ) : (
                  <Text style={s.muted}>Оплата по ссылке недоступна — попросите исполнителя выставить счёт в приложении.</Text>
                )}
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

      <View
        style={[s.card, focusSection === 'docs' && s.focusCard]}
        onLayout={(e) => { docsY.current = e.nativeEvent.layout.y; }}
      >
        <Text style={s.cardHead}>Документы ({snapshot.documents_total})</Text>
        {snapshot.documents.filter((d) => d.status === 'draft').length > 0 ? (
          <View style={s.draftBlock}>
            <Text style={s.draftHead}>Ожидают подписи</Text>
            {snapshot.documents.filter((d) => d.status === 'draft').map((d) => (
              <View key={d.id} style={s.acceptRow}>
                <Text style={s.line}>{d.title} · черновик</Text>
                {canSignPortal ? (
                  <Pressable
                    style={s.acceptBtn}
                    onPress={async () => {
                      try {
const res = await api.portalSignDocument(session.project_id, d.id, portalToken, 'in_app');
                        const next = await refreshPortalSnapshot(session.user_id, session.project_id);
                        const payN = next?.pending_payments?.length ?? 0;
                        Alert.alert(
                          'Подписано',
                          res.status === 'signed' ? d.title : 'Запрос на подпись создан',
                          [
                            { text: 'OK', style: 'cancel' },
                            ...(payN && canPayPortal ? [{ text: 'К оплате', onPress: goPayments }] : []),
                          ],
                        );
                      } catch (e) {
                        Alert.alert('Ошибка', apiErrorMessage(e, 'Не удалось подписать документ'));
                      }
                    }}
                  >
                    <Text style={s.acceptBtnT}>Подписать</Text>
                  </Pressable>
                ) : null}
                {canSignPortal ? (
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
                        await refreshPortalSnapshot(session.user_id, session.project_id);
                      } catch (e) {
                        const msg = apiErrorMessage(e, 'Не удалось открыть подпись');
                        Alert.alert('Контур', (e instanceof ApiError && e.status === 501) ? 'Контур недоступен. Используйте подпись в приложении.' : msg);
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
  shareBtn: { marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: RenovaTheme.colors.primary },
  shareBtnT: { color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 15 },
  hero: { ...card, gap: 6, marginBottom: 4, borderColor: RenovaTheme.colors.primary, borderWidth: 1 },
  brand: { fontSize: 13, fontWeight: '800', letterSpacing: 1.2, color: RenovaTheme.colors.primary },
  brandSub: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted, marginTop: -2 },
  progressLine: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text, marginTop: 4 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: RenovaTheme.colors.border, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: RenovaTheme.colors.primary },
  todoLine: { fontSize: 13, color: RenovaTheme.colors.text, fontWeight: '600' },

  title: { fontSize: 24, fontWeight: '800', color: RenovaTheme.colors.text },
  muted: { fontSize: 14, color: RenovaTheme.colors.textMuted },
  ro: { fontSize: 12, color: RenovaTheme.colors.warning, fontWeight: '600', marginBottom: 8 },
  focusCard: { borderWidth: 2, borderColor: RenovaTheme.colors.primary },
  card: { ...card, gap: 6 },
  cardHead: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  line: { fontSize: 14, color: RenovaTheme.colors.text },
  acceptRow: { gap: 8, marginBottom: 8 },
  acceptBtn: { alignSelf: 'flex-start', backgroundColor: RenovaTheme.colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  acceptBtnT: { color: RenovaTheme.colors.surface, fontWeight: '700', fontSize: 13 },
  konturBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: RenovaTheme.colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  konturBtnT: { color: RenovaTheme.colors.primary, fontWeight: '700', fontSize: 12 },
  payRow: { gap: 8, marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: RenovaTheme.colors.border },
  payActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  payBtn: { backgroundColor: RenovaTheme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  payBtnT: { color: RenovaTheme.colors.surface, fontWeight: '700', fontSize: 13 },
  payBtnOutline: { borderWidth: 1, borderColor: RenovaTheme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  payBtnOutlineT: { color: RenovaTheme.colors.primary, fontWeight: '700', fontSize: 13 },
  draftBlock: { gap: 6, marginBottom: 8 },
  draftHead: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.warningText },
});
