import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api } from '@/lib/api';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { writeResultMessage } from '@/lib/offlineResultMessage';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { reportError } from '@/lib/reportError';

type Sub = Awaited<ReturnType<typeof api.getSubscription>>;

const BENEFITS = [
  'Несколько объектов одновременно',
  'Бригада: приглашение по QR-коду и роли на объекте',
  'Акты, оплаты и выгрузка в 1С без лимита',
  'Приоритет поддержки пилота',
];

export default function SubscriptionScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const [sub, setSub] = useState<Sub | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    try {
      setSub(await api.getSubscription(user.id));
      setLoadError(false);
    } catch (e) {
      // INB-28: сбой загрузки не должен выглядеть как «Бесплатно · 1 объект»
      reportError('app.contractor.subscription.load', e);
      setLoadError(true);
    }
  }, [user?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useProjectDataReload(reload);

  const startTrial = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await api.startProTrial(user.id);
      await syncProjectSideEffects({ user, project: activeProject });
      await reload();
      showActionConfirm({
        title: 'Пробный Pro',
        message: '14 дней открыты. Оформите оплату до конца пробного периода — иначе вернётесь на бесплатный лимит.',
      });
    } catch (e: unknown) {
      showActionConfirm({ title: 'Пробный период', message: writeResultMessage(e, 'Пробный период недоступен') });
    } finally {
      setBusy(false);
    }
  };

  const checkout = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const pay: any = await api.checkoutPro(user.id);
      await syncProjectSideEffects({ user, project: activeProject });
      await reload();
      if (pay.confirmation_url && !pay.demo) {
        await WebBrowser.openBrowserAsync(pay.confirmation_url);
      } else {
        showActionConfirm({
          title: pay.demo ? 'Pro (тестовый режим)' : 'Подписка Про',
          message: pay.message || 'Готово',
        });
      }
      await reload();
    } catch (e: unknown) {
      showActionConfirm({ title: 'Оплата', message: writeResultMessage(e, 'Не удалось начать оплату') });
    } finally {
      setBusy(false);
    }
  };

  const mode = sub?.payments_mode || 'off';
  const modeLabel =
    mode === 'live' ? 'Оплата подключена' : mode === 'demo' ? 'Оплата: тестовый режим' : 'Оплата пока недоступна';

  return (
    <>
      <BackHeader title="Подписка Про" returnTo={returnTo} />
      <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 32 }}>
        {loadError && !sub ? (
          <LoadErrorState
            title="Не удалось загрузить подписку"
            hint="Тариф сейчас неизвестен — это не значит, что у вас бесплатный план. Проверьте сеть и повторите."
            onRetry={() => { void reload(); }}
          />
        ) : null}
        {!sub && !loadError ? <Text style={s.meta}>Загружаем подписку…</Text> : null}
        {sub ? <Text style={s.plan}>
          {sub.is_pro
            ? sub.is_trial
              ? `Пробный Pro · ещё ${sub.days_left ?? '—'} дн.`
              : 'Pro ✓'
            : `Бесплатно · ${sub.free_limit ?? 1} объект`}
        </Text> : null}
        {sub?.expires_at && sub.is_pro ? (
          <Text style={s.meta}>До {sub.expires_at.slice(0, 10)}</Text>
        ) : null}
        {sub ? <Text style={[s.badge, mode === 'live' ? s.badgeOk : s.badgeWarn]}>{modeLabel}</Text> : null}

        <Text style={s.h}>Что даёт Pro</Text>
        {BENEFITS.map((b) => (
          <Text key={b} style={s.bullet}>
            · {b}
          </Text>
        ))}

        {sub && !sub.is_pro && sub.trial_available ? (
          <PrimaryButton
            title={busy ? '…' : `Попробовать ${sub.trial_days ?? 14} дней бесплатно`}
            variant="outline"
            disabled={busy}
            onPress={startTrial}
          />
        ) : null}

        {sub && !sub.is_pro ? (
          <PrimaryButton
            title={busy ? '…' : `Pro ${formatRub(sub.price)}/мес`}
            disabled={busy || mode === 'off'}
            onPress={checkout}
          />
        ) : null}

        {sub?.is_pro && !sub.is_trial ? (
          <Text style={s.meta}>Подписка активна. Продление — через поддержку.</Text>
        ) : null}

        {sub?.is_trial ? (
          <PrimaryButton title={busy ? '…' : `Оформить Pro ${formatRub(sub.price)}/мес`} disabled={busy || mode === 'off'} onPress={checkout} />
        ) : null}

        {sub && mode === 'off' ? (
          <Text style={s.hint}>Оплата подписки пока не подключена. Pro нельзя оформить, пока сервис оплаты недоступен.</Text>
        ) : null}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background },
  plan: { fontSize: 22, fontWeight: '800', marginBottom: 6, color: RenovaTheme.colors.text },
  meta: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  badge: { fontSize: 12, fontWeight: '700', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, overflow: 'hidden', marginBottom: 14, alignSelf: 'flex-start' },
  badgeOk: { backgroundColor: '#ECFDF5', color: '#065F46' },
  badgeWarn: { backgroundColor: '#FFFBEB', color: '#92400E' },
  h: { fontWeight: '800', fontSize: 15, marginBottom: 8, marginTop: 4 },
  bullet: { fontSize: 14, lineHeight: 22, color: RenovaTheme.colors.text, marginBottom: 2 },
  hint: { marginTop: 16, fontSize: 12, lineHeight: 17, color: RenovaTheme.colors.textMuted },
});
