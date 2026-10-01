import { View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { Stage } from '@/lib/api';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { pushStageDetail } from '@/lib/navigation';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { notifyError } from '@/lib/notify';
import { formatScheduleDayFull } from '@/lib/formatScheduleDate';

export function ReworkSlaWidget({
  stages,
  userId,
  projectId,
  role,
  onExtended,
}: {
  stages: Stage[];
  userId?: string;
  projectId?: string;
  role?: string;
  onExtended?: () => void;
}) {
  const pathname = usePathname();
  const { user, activeProject } = useRenova();
  const rework = stages.filter(s => s.needs_rework && s.rework_deadline);
  if (!rework.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>🔄 Доработка ({rework.length})</Text>
      {rework.map(st => (
        <View key={st.id} style={s.row}>
          <Pressable style={{ flex: 1 }} onPress={() => pushStageDetail(st.id, pathname)}>
            <Text style={s.line}>{st.name} · SLA {formatScheduleDayFull(st.rework_deadline)}</Text>
          </Pressable>
          {role === 'contractor' && userId && projectId && (
            <PrimaryButton
              title="Запросить +1 д"
              variant="outline"
              onPress={async () => {
                // STG-002: срок продлевает заказчик — исполнитель отправляет запрос.
                try {
                  await api.extendReworkSla(userId, projectId, st.id, 1);
                } catch (error) {
                  notifyError('Запрос не отправлен', error, 'Повторите позже.');
                  return;
                }
                showActionConfirm({
                  title: 'Запрос отправлен',
                  message: 'Срок доработки изменится, когда заказчик подтвердит продление.',
                  primaryLabel: 'Понятно',
                  onPrimary: () => undefined,
                });
                await syncProjectSideEffects({
                  user: user ?? ({ id: userId } as any),
                  project: activeProject ?? ({ id: projectId } as any),
                  role,
                });
                onExtended?.();
              }}
            />
          )}
        </View>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box:{ backgroundColor:'#fff7ed', padding:12, borderRadius:10, marginBottom:12, borderWidth:1, borderColor:'#fed7aa' },
  head:{ fontWeight:'800', color:'#9a3412', marginBottom:6 },
  row:{ flexDirection:'row', alignItems:'center', gap:8, paddingVertical:4 },
  line:{ fontSize:12, color:'#c2410c' },
});
