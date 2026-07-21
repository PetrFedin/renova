/** W122: шаринг клиентского портала (Houzz/BT) — приёмка / подпись / оплата */
import { useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert, ActivityIndicator } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { apiErrorMessage } from '@/lib/formatPhone';
import { shareRenovaLink } from '@/lib/messengerShare';
import type { OsRole } from '@/constants/osSections';

type Props = {
  userId: string;
  projectId: string;
  role: OsRole;
  embedded?: boolean;
};

export function PortalSharePanel({ userId, projectId, role, embedded }: Props) {
  const { user, activeProject } = useRenova();
  const [allowAccept, setAllowAccept] = useState(true);
  const [allowPay, setAllowPay] = useState(true);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const link = await api.createCustomerPortalLink(userId, projectId, {
        allow_accept_stage: allowAccept,
        allow_pay: allowPay,
      });
      await syncProjectSideEffects({
        user: user ?? ({ id: userId } as any),
        project: activeProject ?? ({ id: projectId } as any),
        role,
      });
      const scopeHint = [
        allowAccept ? 'приёмка и подпись' : null,
        allowPay ? 'оплата' : null,
      ].filter(Boolean).join(' · ') || 'только просмотр';
      await shareRenovaLink(link.url, `портал Renova (${scopeHint})`);
    } catch (e: unknown) {
      Alert.alert('Портал', apiErrorMessage(e, 'Не удалось создать ссылку'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.box, embedded && s.embedded]}>
      <Text style={s.head}>
        {role === 'contractor' ? 'Ссылка заказчику' : 'Мой клиентский портал'}
      </Text>
      <Text style={s.hint}>
        {role === 'contractor'
          ? 'Заказчик откроет ЛК без приложения: приёмка этапа, подпись акта, оплата.'
          : 'Отправьте себе или родственнику ссылку на решения по объекту.'}
      </Text>
      <View style={s.row}>
        <Text style={s.label}>Приёмка и подпись</Text>
        <Switch value={allowAccept} onValueChange={setAllowAccept} />
      </View>
      <View style={s.row}>
        <Text style={s.label}>Оплата счетов</Text>
        <Switch value={allowPay} onValueChange={setAllowPay} />
      </View>
      <PrimaryButton
        title={busy ? '…' : 'Поделиться ссылкой'}
        variant="outline"
        disabled={busy}
        onPress={share}
      />
      {busy ? <ActivityIndicator style={{ marginTop: 8 }} color={RenovaTheme.colors.primary} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: RenovaTheme.radius.lg,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    gap: 8,
  },
  embedded: { marginBottom: 0, padding: 0, borderWidth: 0, backgroundColor: 'transparent' },
  head: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 14, color: RenovaTheme.colors.text, flex: 1, paddingRight: 12 },
});
