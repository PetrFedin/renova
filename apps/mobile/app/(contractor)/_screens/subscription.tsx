import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { RenovaTheme, formatRub } from '@/constants/Theme';

type Sub = Awaited<ReturnType<typeof api.getSubscription>>;

const BENEFITS = [
  'Несколько объектов одновременно',
  'Бригада по QR и роли field',
  'Акты, оплатыта, 1С-экспорт без лимита',
  'Приоритет поддержки пилота',
];

export default function SubscriptionScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useRenova();
  const [sub, setSub] = useState<Sub | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    setSub(await api.getSubscription(user.id));
  }, [user?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startTrial = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await api.startProTrial(user.id);
      await reload();
      Alert.alert('Пробный Pro', '14 дней открыты. Оформите оплату до конца trial — иначе вернётесь на бесплатный лимит.');
    } catch (e: unknown) {
      Alert.alert('Trial', e instanceof Error ? e.message : 'Пробный период недоступен');
    } finally {
      setBusy(false);
    }
  };

  const checkout = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const pay: any = await api.checkoutPro(user.id);
      if (pay.confirmation_url && !pay.demo) {
        await WebBrowser.openBrowserAsync(pay.confirmation_url);
      } else {
        Alert.alert(
          pay.demo ? 'Pro (demo)' : 'Подписка Про',
          pay.message || 'Готово',
        );
      }
      await reload();
    } catch (e: unknown) {
      Alert.alert('Оплата', e instanceof Error ? e.message : 'Не удалось начать оплату');
    } finally {
      setBusy(false);
    }
  };

  const mode = sub?.payments_mode || 'off';
  const modeLabel =
    mode === 'live' ? 'Оплата: live ЮKassa' : mode === 'demo' ? 'Оплата: demo (только development)' : 'Оплата: off — нужны YOOKASSA_*';

  return (
    <>
      <BackHeader title="Подписка Про" returnTo={returnTo} />
      <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={s.plan}>
          {sub?.is_pro
            ? sub.is_trial
              ? `Пробный Pro · ещё ${sub.days_left ?? '—'} дн.`
              : 'Pro ✓'
            : `Бесплатно · ${sub?.free_limit ?? 1} объект`}
        </Text>
        {sub?.expires_at && sub.is_pro ? (
          <Text style={s.meta}>До {sub.expires_at.slice(0, 10)}</Text>
        ) : null}
        <Text style={[s.badge, mode === 'live' ? s.badgeOk : s.badgeWarn]}>{modeLabel}</Text>

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
          <Text style={s.meta}>Подписка активна. Продление — через ЮKassa / поддержку пилота.</Text>
        ) : null}

        {sub?.is_trial ? (
          <PrimaryButton title={busy ? '…' : `Оформить Pro ${formatRub(sub.price)}/мес`} disabled={busy || mode === 'off'} onPress={checkout} />
        ) : null}

        <Text style={s.hint}>
          Staging/production не активируют Pro без ключей ЮKassa (честный режим). Demo-активация только в development.
        </Text>
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
