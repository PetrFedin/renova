/** Заявки marketplace — КП → проект (W119 SoT + W130 CTAs + W140 форма) */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { api } from '@/lib/api';
import { LeadChat } from '@/components/renova/LeadChat';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { CreateJobLeadSheet } from '@/components/renova/CreateJobLeadSheet';
import type { JobLeadCreateBody } from '@/lib/api/market';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import {
  alertJobLeadAssigned,
  alertJobLeadCreated,
  alertJobLeadQuoted,
} from '@/lib/jobLeadNav';
import type { OsRole } from '@/constants/osSections';
import { reportError } from '@/lib/reportError';

const RENOVATION_LABEL: Record<string, string> = {
  cosmetic: 'Косметический',
  capital: 'Капитальный',
  bathroom: 'Ванная',
  kitchen: 'Кухня',
};

type L = {
  id: string;
  title: string;
  address?: string;
  area_sqm?: number;
  renovation_type: string;
  budget_hint?: number;
  pre_estimate?: number;
  description?: string | null;
  status: string;
};

export function JobLeadsBoard({ userId, role }: { userId: string; role: string }) {
  const { user, activeProject, loadProject, refreshProjects } = useRenova();
  const [items, setItems] = useState<L[]>([]);
  const [quote, setQuote] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const osRole = (role === 'contractor' ? 'contractor' : 'customer') as OsRole;
  const sync = () =>
    syncProjectSideEffects({
      user: user ?? ({ id: userId } as any),
      project: activeProject,
    });

  const load = useCallback(() => {
    api
      .listJobLeads(userId)
      .then((rows) => {
        setItems(rows);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);
  useProjectDataReload(load);

  const onCreateLead = async (body: JobLeadCreateBody) => {
    setCreating(true);
    try {
      await api.createJobLead(userId, body);
      alertJobLeadCreated(osRole);
      try {
        await sync();
        load();
      } catch {
        /* заявка уже создана */
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={s.box}>
      {role === 'contractor' && (
        <View style={s.info}>
          <Text style={s.infoT}>Новые объекты — через заявки</Text>
          <Text style={s.infoSub}>
            Ответьте КП → заказчик принимает → «→ Проект». Создать объект вручную нельзя (лимит Pro).
          </Text>
        </View>
      )}
      <Text style={s.head}>Заявки</Text>
      {loadError ? (
        <Text style={s.err}>Не удалось загрузить заявки. Откройте экран снова.</Text>
      ) : null}
      {items.map((l) => (
        <View key={l.id} style={s.row}>
          <Text style={s.n}>
            {l.title} · {l.status}
          </Text>
          <Text style={s.sub}>
            {[
              RENOVATION_LABEL[l.renovation_type] || l.renovation_type,
              l.address,
              l.area_sqm != null ? `${l.area_sqm} м²` : null,
              l.budget_hint != null ? formatRub(l.budget_hint) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {l.description ? (
            <Text style={s.desc} numberOfLines={2}>
              {l.description}
            </Text>
          ) : null}
          {l.pre_estimate ? <Text style={s.q}>Оценка: {formatRub(l.pre_estimate)}</Text> : null}
          <LeadChat userId={userId} leadId={l.id} />
          {role === 'customer' && l.status === 'open' ? (
            <PrimaryButton
              title="Авто-исполнитель"
              variant="outline"
              onPress={async () => {
                await api.autoAssignLead(userId, l.id);
                await sync();
                load();
                alertJobLeadAssigned(osRole);
              }}
            />
          ) : null}
          {l.status === 'quoted' ? (
            <PrimaryButton
              title="→ Проект"
              variant="outline"
              onPress={async () => {
                if (role === 'contractor') {
                  pushOsNav({ pathname: `/contractor-wizard/${l.id}` }, '/job-leads', osRole);
                  return;
                }
                const r = await api.convertJobLead(userId, l.id);
                await refreshProjects();
                if (r?.project_id) {
                  await loadProject(r.project_id);
                  await sync();
                  replaceOsNav(
                    role === 'contractor' ? '/(contractor)/(tabs)/' : '/(customer)/(tabs)/',
                    undefined,
                    osRole,
                  );
                }
                load();
              }}
            />
          ) : null}
          {role === 'contractor' && l.status === 'open' ? (
            <View style={s.qrow}>
              <TextInput
                style={s.inp}
                placeholder="₽"
                keyboardType="numeric"
                value={quote[l.id] || ''}
                onChangeText={(v) => setQuote({ ...quote, [l.id]: v })}
              />
              <PrimaryButton
                title="КП"
                onPress={async () => {
                  await api.quoteJobLead(userId, l.id, parseFloat(quote[l.id] || '0'));
                  await sync();
                  load();
                  alertJobLeadQuoted(osRole);
                }}
              />
            </View>
          ) : null}
        </View>
      ))}
      {role === 'customer' ? (
        <>
          <PrimaryButton
            title="+ Заявка"
            variant="outline"
            disabled={creating}
            onPress={() => setCreateOpen(true)}
          />
          <CreateJobLeadSheet
            visible={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreate={onCreateLead}
          />
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  info: {
    backgroundColor: RenovaTheme.colors.infoBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  infoT: { fontWeight: '700', marginBottom: 4 },
  infoSub: { fontSize: 12, color: '#475569', lineHeight: 17 },
  box: { marginVertical: 10 },
  head: { fontWeight: '800', marginBottom: 8 },
  err: { fontSize: 12, color: RenovaTheme.colors.danger, marginBottom: 8 },
  row: { backgroundColor: RenovaTheme.colors.surface, padding: 10, borderRadius: 8, marginBottom: 6 },
  n: { fontWeight: '600' },
  sub: { fontSize: 11, color: '#666', marginTop: 2 },
  desc: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 16 },
  q: { fontWeight: '700', color: '#2563eb', marginTop: 4 },
  qrow: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  inp: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, flex: 1 },
});
