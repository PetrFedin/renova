/** Исполнитель: условия принятой заявки. Объект из заявки создаёт заказчик (MKT-028). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { replaceOsNav } from '@/lib/pushOsNav';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { Card } from '@/components/ui/Card';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { BackHeader } from '@/components/renova/BackHeader';
import { reportError } from '@/lib/reportError';
import { loadQuotedLead } from '@/lib/leadConversionRecovery';

type JobLead = Awaited<ReturnType<typeof api.listJobLeads>>[number];
type LeadLoadState = 'loading' | 'ready' | 'error' | 'unavailable';

export default function ContractorLeadWizard() {
  const { leadId, returnTo } = useLocalSearchParams<{ leadId: string; returnTo?: string }>();
  const { user } = useRenova();
  const userId = user?.id;
  const role = user?.role;
  const scopeKey = `${userId ?? ''}:${role ?? ''}:${leadId ?? ''}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const mounted = useRef(true);
  const loadRequest = useRef(0);
  const [lead, setLead] = useState<JobLead | null>(null);
  const [loadState, setLoadState] = useState<LeadLoadState>('loading');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadRequest.current += 1; };
  }, []);

  const loadLead = useCallback(async () => {
    const request = ++loadRequest.current;
    const isCurrent = () => mounted.current && scopeRef.current === scopeKey && loadRequest.current === request;
    setLead(null);
    setLoadState('loading');
    if (!userId || !leadId || role !== 'contractor') {
      setLoadState('unavailable');
      return;
    }
    try {
      // The board sends an accepted lead here. The API default is open, not quoted.
      const found = await loadQuotedLead((status) => api.listJobLeads(userId, status), leadId);
      if (!isCurrent()) return;
      setLead(found);
      setLoadState(found ? 'ready' : 'unavailable');
    } catch (error) {
      reportError('contractorWizard.load', error, { userId, leadId });
      if (isCurrent()) setLoadState('error');
    }
  }, [userId, role, leadId, scopeKey]);

  useEffect(() => {
    void loadLead();
    return () => { loadRequest.current += 1; };
  }, [loadLead]);

  if (!userId || role !== 'contractor') {
    return <View style={s.center}><Text>Экран доступен авторизованному исполнителю.</Text></View>;
  }
  if (loadState !== 'ready' || !lead) {
    return (
      <>
        <BackHeader title="Условия заявки" returnTo={returnTo} />
        <View style={s.stateBox}>
          {loadState === 'loading' ? <><ActivityIndicator /><Text>Загрузка заявки…</Text></> : null}
          {loadState === 'error' ? <Text>Не удалось загрузить заявку. Это не означает, что её нет.</Text> : null}
          {loadState === 'unavailable' ? <Text>Заявка недоступна: возможно, объект уже создан. Проверьте свои проекты.</Text> : null}
          {loadState !== 'loading' ? (
            <>
              <PrimaryButton title="Повторить загрузку" variant="outline" onPress={() => void loadLead()} />
              <PrimaryButton title="К заявкам" variant="outline" onPress={() => replaceOsNav('/job-leads', undefined, 'contractor')} />
            </>
          ) : null}
        </View>
      </>
    );
  }

  return (
    <>
      <BackHeader title="Условия заявки" returnTo={returnTo} subtitle={lead.title} />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16 }}>
        <Text style={s.meta}>{lead.address || '—'} · {lead.renovation_type} · {lead.area_sqm || '?'} м²</Text>
        <Card variant="base" style={s.cardGap}>
          {lead.pre_estimate ? (
            <>
              <Text style={s.label}>Цена вашего принятого КП</Text>
              <Text style={s.total}>{formatRub(lead.pre_estimate)}</Text>
            </>
          ) : (
            <Text style={s.label}>Цена КП в заявке не указана.</Text>
          )}
          {lead.budget_hint != null ? (
            <Text style={s.meta}>Ориентир бюджета заказчика: {formatRub(lead.budget_hint)}</Text>
          ) : null}
          {lead.description ? <Text style={s.desc}>{lead.description}</Text> : null}
        </Card>
        <Text style={s.meta}>
          Объект из заявки создаёт заказчик — он сам укажет состав помещений. Обсудите детали
          в чате заявки; когда объект появится, мы пришлём уведомление.
        </Text>
        <PrimaryButton title="К заявкам" variant="outline" onPress={() => replaceOsNav('/job-leads', undefined, 'contractor')} />
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateBox: { padding: 16, gap: 12, backgroundColor: RenovaTheme.colors.background },
  meta: { color: RenovaTheme.colors.textMuted, marginBottom: 12 },
  cardGap: { marginBottom: 12 },
  label: { color: RenovaTheme.colors.textMuted, fontSize: 13 },
  desc: { marginTop: 8, lineHeight: 18 },
  total: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.primary, marginVertical: 4 },
});
