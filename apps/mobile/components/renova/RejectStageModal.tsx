import { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { RejectTemplates } from '@/components/renova/RejectTemplates';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { normalizeReturnReason } from '@/lib/domain/acceptanceActions';

/** Возврат этапа на доработку: причина обязательна — исполнитель увидит её на этапе. */
export function RejectStageModal({ visible, stageName, onClose, onConfirm }: { visible: boolean; stageName: string; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const clean = normalizeReturnReason(reason);
  const close = () => { setReason(''); onClose(); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={s.overlay}>
        <View style={s.box}>
          <Text style={s.head}>Вернуть на доработку: {stageName}</Text>
          <RejectTemplates onPick={setReason} />
          <TextInput style={s.input} placeholder="Что нужно исправить (обязательно)…" value={reason} onChangeText={setReason} multiline />
          {!clean ? <Text style={s.hint}>Опишите, что переделать — исполнитель увидит это в задаче.</Text> : null}
          <View style={s.row}>
            <Pressable onPress={close}><Text style={s.cancel}>Отмена</Text></Pressable>
            <PrimaryButton title="Вернуть" variant="accent" disabled={!clean} onPress={() => { if (!clean) return; onConfirm(clean); setReason(''); }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  overlay:{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', padding:24 },
  box:{ backgroundColor:RenovaTheme.colors.surface, borderRadius:12, padding:16 },
  head:{ fontWeight:'800', marginBottom:12 },
  input:{ borderWidth:1, borderColor:RenovaTheme.colors.border, borderRadius:8, padding:10, minHeight:80, marginBottom:8 },
  hint:{ color: RenovaTheme.colors.textMuted, fontSize: RenovaTheme.fontSize.bodySmall, marginBottom: 8 },
  row:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  cancel:{ color: RenovaTheme.colors.textMuted, padding:8 },
});
