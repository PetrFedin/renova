import { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { api, ApprovalItem } from '@/lib/api';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';

import { router } from 'expo-router';
import { APPROVAL_TYPE_LABEL, approvalSourceLabel, resolveApprovalHref } from '@/lib/approvalLinks';
import { navigateApproval } from '@/lib/navigation';
import type { OsRole } from '@/constants/osSections';

export default function ApprovalsScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const isCustomer = user?.role === 'customer';

  const load = () => {
    if (user && activeProject) api.approvalHub(user.id, activeProject.id).then(r => setItems(r.items)).catch(() => {});
  };
  useEffect(() => { load(); }, [activeProject?.id]);

  const key = (it: ApprovalItem) => `${it.type}-${it.id}`;
  const reason = (it: ApprovalItem) => reasons[key(it)] || '';

  const approve = async (it: ApprovalItem) => {
    if (!user || !activeProject || !isCustomer) return;
    const { id: userId } = user;
    const pid = activeProject.id;
    if (it.type === 'material') await api.approveMaterialPick(userId, pid, it.id);
    if (it.type === 'change_order') await api.approveChangeOrder(userId, pid, it.id);
    if (it.type === 'room_change') await api.approveRoomChange(userId, pid, it.id);
    if (it.type === 'design') await api.approveDesignPackage(userId, pid, it.id);
    if (it.type === 'waste') await api.approveWasteOrder(userId, pid, it.id);
    load();
  };

  return (
    <>
      <BackHeader title="Согласования" returnTo={returnTo} subtitle={isCustomer ? undefined : 'Только просмотр — решает заказчик'} />
      <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 24 }}>
        {!isCustomer && items.length > 0 && (
          <Text style={s.hint}>Отправлено заказчику на подтверждение. Вы получите уведомление после решения.</Text>
        )}
        {items.map(it => (
          <View key={key(it)} style={s.card}>
            <Text style={s.type}>{APPROVAL_TYPE_LABEL[it.type] || it.type}</Text>
            <Pressable onPress={() => navigateApproval(it, (isCustomer ? 'customer' : 'contractor') as OsRole, returnTo)}>
            <Text style={s.title}>{it.title}</Text>
            {resolveApprovalHref(it, (isCustomer ? 'customer' : 'contractor') as OsRole) ? (
              <Text style={s.link}>{approvalSourceLabel(it)}</Text>
            ) : null}
          </Pressable>
            {it.subtitle ? <Text style={s.sub}>{it.subtitle}</Text> : null}
            {isCustomer ? (
              <>
                <TextInput
                  style={s.inp}
                  placeholder="Комментарий при отклонении"
                  value={reason(it)}
                  onChangeText={(v) => setReasons(prev => ({ ...prev, [key(it)]: v }))}
                />
                <View style={s.actions}>
                  <PrimaryButton title="Согласовать" onPress={() => approve(it)} />
                  <PrimaryButton title="Отклонить" variant="outline" onPress={async () => {
                    if (!user || !activeProject) return;
                    await api.rejectApproval(user.id, activeProject.id, it.id, it.type, reason(it));
                    load();
                  }} />
                </View>
              </>
            ) : (
              <Text style={s.wait}>Статус: ожидает заказчика</Text>
            )}
          </View>
        ))}
        {!items.length && <Text style={s.empty}>Нет ожидающих согласований</Text>}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background, padding: 16 },
  hint: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 12, lineHeight: 18 },
  card: { backgroundColor: RenovaTheme.colors.surface, padding: 14, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  type: { fontSize: 11, color: RenovaTheme.colors.accent, fontWeight: '700' },
  title: { fontWeight: '700', marginTop: 4 },
  sub: { color: RenovaTheme.colors.textMuted, marginTop: 4, marginBottom: 8 },
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 8, marginBottom: 8, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8 },
  wait: { marginTop: 8, fontSize: 13, color: RenovaTheme.colors.warning, fontWeight: '600' },
  link: { fontSize: 12, color: RenovaTheme.colors.primary, marginTop: 4, fontWeight: '600' },
  empty: { textAlign: 'center', color: RenovaTheme.colors.textMuted, marginTop: 40 },
});
