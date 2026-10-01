/** W122: шаринг клиентского портала (Houzz/BT) — приёмка / подпись / оплата */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { notifyError } from '@/lib/notify';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { apiErrorMessage } from '@/lib/formatPhone';
import { shareRenovaLink } from '@/lib/messengerShare';
import type { OsRole } from '@/constants/osSections';
import { alertPortalLinkShared } from '@/lib/shareAccessNav';
import { portalLinkRowLabel, type PortalLinkRow } from '@/lib/domain/portalLinks';
import { reportCatch } from '@/lib/reportError';

type Props = {
  userId: string;
  projectId: string;
  role: OsRole;
  embedded?: boolean;
};

export function PortalSharePanel({ userId, projectId, role, embedded }: Props) {
  const { user, activeProject } = useRenova();
  const [allowAccept, setAllowAccept] = useState(false);
  const [allowPay, setAllowPay] = useState(false);
  // Исполнитель выдаёт только ссылку на просмотр: права заказчика выпускает лишь заказчик.
  const canGrant = role !== 'contractor';
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<PortalLinkRow[]>([]);

  const loadLinks = useCallback(async () => {
    try {
      const r = await api.listPortalLinks(userId, projectId);
      setLinks(r.items);
    } catch (e) {
      reportCatch('components.renova.PortalSharePanel.list')(e);
    }
  }, [userId, projectId]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await api.revokePortalLink(userId, projectId, id);
      await loadLinks();
    } catch (e: unknown) {
      notifyError('Портал', e, 'Не удалось отозвать ссылку');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const link = await api.createCustomerPortalLink(userId, projectId, {
        allow_accept_stage: canGrant && allowAccept,
        allow_pay: canGrant && allowPay,
      });
      await syncProjectSideEffects({
        user: user ?? ({ id: userId } as any),
        project: activeProject ?? ({ id: projectId } as any),
        role,
      });
      const scopeHint = [
        canGrant && allowAccept ? 'приёмка и подпись' : null,
        canGrant && allowPay ? 'оплата' : null,
      ].filter(Boolean).join(' · ') || 'только просмотр';
      await shareRenovaLink(link.url, `портал Renova (${scopeHint})`);
      // W135: после шаринга — приёмка / оплаты в кабинете
      alertPortalLinkShared(role, scopeHint);
      void loadLinks();
    } catch (e: unknown) {
      notifyError('Портал', e, 'Не удалось создать ссылку');
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
          ? 'Заказчик откроет ЛК без приложения — только просмотр. Приёмку, подпись и оплату заказчик включает сам.'
          : 'Отправьте себе или родственнику ссылку на решения по объекту.'}
      </Text>
      {canGrant ? (
        <>
          <View style={s.row}>
            <Text style={s.label}>Приёмка и подпись</Text>
            <Switch value={allowAccept} onValueChange={setAllowAccept} />
          </View>
          <View style={s.row}>
            <Text style={s.label}>Оплата счетов</Text>
            <Switch value={allowPay} onValueChange={setAllowPay} />
          </View>
        </>
      ) : null}
      <PrimaryButton
        title={busy ? '…' : 'Поделиться ссылкой'}
        variant="outline"
        disabled={busy}
        onPress={share}
      />
      {links.length ? <Text style={s.hint}>Активные ссылки — отзовите, если отправили не тому или ссылка утекла:</Text> : null}
      {links.map((l) => (
        <View key={l.id} style={s.row}>
          <Text style={s.label}>{portalLinkRowLabel(l)}</Text>
          <PrimaryButton title="Отозвать" variant="outline" disabled={busy} onPress={() => revoke(l.id)} />
        </View>
      ))}
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
