/** Квиз детализации при первом входе */
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { RenovaTheme } from '@/constants/Theme';
import { navigateAfterLogin } from '@/lib/osEntry';
import { DetailLevelPreview } from '@/components/renova/DetailLevelPreview';

const MODES = [
  { id: 'brief', label: 'Кратко', desc: 'Только ключевые цифры и статусы' },
  { id: 'standard', label: 'Стандарт', desc: 'Баланс деталей и скорости' },
  { id: 'detailed', label: 'Подробно', desc: 'Все метрики, графики, логи' },
];

export default function DetailQuizScreen() {
  const { logout } = useRenova();
  const [mode, setMode] = useState('standard');
  useEffect(() => { AsyncStorage.getItem('renova_user_role').then(r => setMode(r === 'contractor' ? 'detailed' : r === 'customer' ? 'standard' : 'standard')); }, []);
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    try {
      await AsyncStorage.setItem('renova_detail_level', mode);
      await AsyncStorage.setItem('renova_detail_quiz_done', '1');
      const role = (await AsyncStorage.getItem('renova_user_role')) === 'contractor' ? 'contractor' : 'customer';
      await navigateAfterLogin(role);
    } finally {
      setBusy(false);
    }
  };
  const backToRole = async () => {
    await logout();
    router.replace('/onboarding/role');
  };
  return (
    <View style={s.wrap}>
      <Pressable onPress={backToRole} style={s.back} accessibilityRole="button">
        <Text style={s.backText}>← Выбор роли</Text>
        <Text style={s.backSub}>Заказчик · Исполнитель · Наблюдатель</Text>
      </Pressable>
      <Text style={s.title}>Как показывать информацию?</Text>
      {MODES.map(m => (
        <Pressable key={m.id} style={[s.card, mode === m.id && s.on]} onPress={() => setMode(m.id)}>
          <Text style={s.lbl}>{m.label}</Text>
          <Text style={s.desc}>{m.desc}</Text>
        </Pressable>
      ))}
      <DetailLevelPreview mode={mode} />
      <PrimaryButton title="Продолжить" onPress={finish} loading={busy} />
    </View>
  );
}
const s = StyleSheet.create({
  wrap:{ flex:1, padding:20, backgroundColor: RenovaTheme.colors.background, justifyContent:'center' },
  back:{ marginBottom:16, padding:12, borderRadius:10, backgroundColor:RenovaTheme.colors.surface, borderWidth:1, borderColor:'#dbeafe' },
  backText:{ fontSize:15, fontWeight:'800', color: RenovaTheme.colors.primary },
  backSub:{ fontSize:12, color:'#64748b', marginTop:2 },
  title:{ fontSize:20, fontWeight:'800', marginBottom:16 },
  card:{ backgroundColor:RenovaTheme.colors.surface, padding:14, borderRadius:10, marginBottom:10, borderWidth:2, borderColor:'transparent' },
  on:{ borderColor: RenovaTheme.colors.primary },
  lbl:{ fontWeight:'700' }, desc:{ fontSize:12, color:'#666', marginTop:4 },
});
