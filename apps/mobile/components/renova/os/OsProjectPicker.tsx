/** Выбор проекта в шапке — компактный список вместо больших chips на главной */
import { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { useTopInset } from '@/lib/useTopInset';
import { useRenova } from '@/lib/context/RenovaContext';
import { useOsNavFromHere } from '@/lib/navigation';
import { api, type ProjectSummary } from '@/lib/api';
import { formatProjectPhaseLabel } from '@/lib/domain/formatProjectPhaseLabel';
import type { OsRole } from '@/constants/osSections';

function projectMeta(p: ProjectSummary, pendingById: Record<string, number>): string {
  const type = p.property_type === 'house' ? 'Дом' : 'Квартира';
  const rooms = p.rooms_count ? `${p.rooms_count} комн.` : '';
  const pending = pendingById[p.id];
  const phase = formatProjectPhaseLabel(p, pending);
  const addr = p.address?.trim();
  return [type, rooms, phase, addr].filter(Boolean).join(' · ');
}

export function OsProjectPicker({ role }: { role: OsRole }) {
  const topInset = useTopInset();
  const { pushTab, pushScreen } = useOsNavFromHere(role);
  const { user, projects, activeProject, loadProject, showPaywall } = useRenova();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingById, setPendingById] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open || !user || role !== 'customer') return;
    const closing = projects.filter((p) => p.progress_percent >= 100);
    if (!closing.length) {
      setPendingById({});
      return;
    }
    let cancelled = false;
    Promise.all(
      closing.map(async (p) => {
        if (p.pending_payments != null) return [p.id, p.pending_payments] as const;
        try {
          const n = (await api.countPendingPayments(user.id, p.id)) || 0;
          return [p.id, n] as const;
        } catch {
          return [p.id, 0] as const;
        }
      }),
    ).then((rows) => {
      if (!cancelled) setPendingById(Object.fromEntries(rows));
    });
    return () => { cancelled = true; };
  }, [open, user?.id, projects, role]);

  if (!activeProject || projects.length === 0) return null;

  async function select(id: string) {
    if (id === activeProject?.id) {
      setOpen(false);
      return;
    }
    setBusyId(id);
    try {
      await loadProject(id);
      setOpen(false);
    } catch (e: any) {
      if (e?.code === 'subscription_required' || e?.status === 402) showPaywall();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Pressable
        style={s.btn}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Проект: ${activeProject.name}`}
        hitSlop={8}
      >
        <Ionicons name="business-outline" size={22} color={RenovaTheme.colors.text} />
        {projects.length > 1 ? (
          <View style={s.countBadge}>
            <Text style={s.countBadgeT}>{projects.length}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <View style={[s.menuWrap, { paddingTop: topInset + 56 }]} pointerEvents="box-none">
            <Pressable style={s.menu} onPress={(e) => e.stopPropagation()}>
              <Text style={s.menuHead}>Объекты</Text>
              {projects.map((p) => {
                const active = p.id === activeProject.id;
                const loading = busyId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    style={[s.item, active && s.itemOn]}
                    onPress={() => select(p.id)}
                    disabled={!!busyId}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.itemTitle, active && s.itemTitleOn]} numberOfLines={1}>{p.name}</Text>
                      <Text style={s.itemMeta} numberOfLines={2}>{projectMeta(p, pendingById)}</Text>
                      <Text style={s.itemProgress} numberOfLines={1}>
                        {formatRub(p.budget_spent)} / {formatRub(p.budget_planned)} · {p.progress_percent}%
                      </Text>
                    </View>
                    {loading ? (
                      <ActivityIndicator size="small" color={RenovaTheme.colors.accent} />
                    ) : active ? (
                      <Ionicons name="checkmark-circle" size={20} color={RenovaTheme.colors.accent} />
                    ) : null}
                  </Pressable>
                );
              })}

              {projects.length >= 2 && (
                <>
                  <View style={s.divider} />
                  <Pressable
                    style={s.item}
                    onPress={() => {
                      setOpen(false);
                      pushScreen('/portfolio');
                    }}
                  >
                    <Ionicons name="albums-outline" size={18} color={RenovaTheme.colors.textMuted} />
                    <Text style={s.itemT}>Все проекты ({projects.length})</Text>
                  </Pressable>
                </>
              )}

              <View style={s.divider} />
              <Pressable
                style={s.item}
                onPress={() => {
                  setOpen(false);
                  pushTab('object', 'profile');
                }}
              >
                <Ionicons name="create-outline" size={18} color={RenovaTheme.colors.textMuted} />
                <Text style={s.itemT}>Редактировать профиль</Text>
              </Pressable>
              <Pressable
                style={s.item}
                onPress={() => {
                  setOpen(false);
                  pushScreen('/wizard/type');
                }}
              >
                <Ionicons name="add-circle-outline" size={18} color={RenovaTheme.colors.accent} />
                <Text style={[s.itemT, { color: RenovaTheme.colors.accent }]}>Новый проект</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  countBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: RenovaTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  countBadgeT: { color: '#fff', fontSize: 8, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  menuWrap: { flex: 1, alignItems: 'flex-end', paddingRight: 12 },
  menu: {
    minWidth: 280,
    maxWidth: 340,
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: RenovaTheme.radius.md,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  menuHead: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  itemOn: { backgroundColor: RenovaTheme.colors.borderLight },
  itemTitle: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  itemTitleOn: { color: RenovaTheme.colors.accent },
  itemMeta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2, lineHeight: 16 },
  itemProgress: { fontSize: 11, color: RenovaTheme.colors.textSubtle, marginTop: 4 },
  itemT: { flex: 1, fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  divider: { height: 1, backgroundColor: RenovaTheme.colors.border, marginVertical: 6, marginHorizontal: 12 },
});
