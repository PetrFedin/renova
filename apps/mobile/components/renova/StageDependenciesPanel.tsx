/** Зависимости этапов — блокировки, материалы, синхронизация workflow */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router, useFocusEffect, usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import type { OsRole } from '@/constants/osSections';
import { STAGE_DEPENDENCY_TYPE_LABEL } from '@/constants/labels';

type Dep = {
  id: string;
  stage_id: string;
  stage_name?: string;
  depends_on_stage_name?: string;
  material_name?: string;
  dependency_type: string;
  status: string;
};

const STATUS_COLOR: Record<string, string> = {
  blocked: RenovaTheme.colors.danger,
  pending: RenovaTheme.colors.warning,
  satisfied: RenovaTheme.colors.success,
  open: RenovaTheme.colors.textMuted,
};

export function StageDependenciesPanel({
  userId,
  projectId,
  role,
}: {
  userId: string;
  projectId: string;
  role: OsRole;
}) {
  const pathname = usePathname();
  const canWrite = useWriteAllowed();
  const [items, setItems] = useState<Dep[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await api.listDependencies(userId, projectId);
      setItems(list);
    } catch {
      setItems([]);
    }
  }, [userId, projectId]);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));
  useProjectDataReload(reload);

  const blocked = items.filter((d) => d.status === 'blocked' || d.status === 'pending');
  if (!items.length && !canWrite) return null;

  return (
    <View style={s.wrap}>
      <View style={s.headRow}>
        <Text style={s.head}>Зависимости · {blocked.length || items.length}</Text>
        {canWrite && role === 'contractor' && (
          <PrimaryButton
            compact
            title={busy ? '…' : 'Синхр.'}
            variant="outline"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await api.syncDependencies(userId, projectId);
                await syncProjectSideEffects({ user: { id: userId } as any, project: { id: projectId } as any });
                await reload();
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </View>
      {!items.length && <Text style={s.empty}>Нет зависимостей. Нажмите «Синхр.» после изменения этапов.</Text>}
      {items.slice(0, 6).map((d) => (
        <Pressable
          key={d.id}
          style={s.row}
          onPress={() => router.push({ pathname: '/stage/[id]', params: { id: d.stage_id, returnTo: pathname } } as any)}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{d.stage_name || 'Этап'}</Text>
            <Text style={s.sub} numberOfLines={2}>
              {STAGE_DEPENDENCY_TYPE_LABEL[d.dependency_type] || d.dependency_type}
              {d.depends_on_stage_name ? ` · ждёт «${d.depends_on_stage_name}»` : ''}
              {d.material_name ? ` · «${d.material_name}»` : ''}
            </Text>
          </View>
          <Text style={[s.status, { color: STATUS_COLOR[d.status] || RenovaTheme.colors.textMuted }]}>
            {d.status === 'blocked' ? 'Блок' : d.status === 'satisfied' ? 'OK' : d.status}
          </Text>
        </Pressable>
      ))}
      {items.length > 6 && <Text style={s.more}>+ ещё {items.length - 6}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { ...card, marginBottom: 12 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  head: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0', gap: 8 },
  title: { fontSize: 14, fontWeight: '700' },
  sub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  status: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  more: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 6 },
});
