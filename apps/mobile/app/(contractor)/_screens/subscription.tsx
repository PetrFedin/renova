import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { RenovaTheme, formatRub } from '@/constants/Theme';

export default function SubscriptionScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useRenova();
  const [sub, setSub] = useState<any>(null);
  useEffect(() => { if (user) api.getSubscription(user.id).then(setSub); }, [user?.id]);

  const checkout = async () => {
    if (!user) return;
    const pay: any = await api.checkoutPro(user.id);
    if (pay.confirmation_url && !pay.demo) await WebBrowser.openBrowserAsync(pay.confirmation_url);
    else Alert.alert('Подписка Про', pay.message || 'Готово');
    setSub(await api.getSubscription(user.id));
  };

  return (
    <>
      <BackHeader title="Подписка Про" returnTo={returnTo} />
      <View style={s.wrap}>
        <Text style={s.plan}>{sub?.is_pro ? 'Про ✓' : `Бесплатно · ${sub?.free_limit ?? 1} объект`}</Text>
        {sub && !sub.is_pro && <PrimaryButton title={`Про ${formatRub(sub.price)}/мес`} onPress={checkout} />}
      </View>
    </>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background }, plan: { fontSize: 20, fontWeight: '800', marginBottom: 16 } });
