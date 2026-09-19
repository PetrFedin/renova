import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, View, Text, TextInput, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { RejectTemplates } from '@/components/renova/RejectTemplates';
import { PrimaryButton } from '@/components/renova/PrimaryButton';

export function RejectStageModal({ visible, stageName, onClose, onConfirm }: { visible: boolean; stageName: string; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/*
        Окно стоит по центру, а поле причины — многострочное. На iPhone SE
        клавиатура (~290 pt) закрывала нижнюю часть окна вместе с кнопками
        «Отмена» и «Отклонить»: написать причину было можно, подтвердить — нет.
      */}
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.box}>
          <Text style={s.head}>Отклонить: {stageName}</Text>
          <RejectTemplates onPick={setReason} />
          <TextInput style={s.input} placeholder="Причина доработки…" value={reason} onChangeText={setReason} multiline />
          <View style={s.row}>
            {/*
              «Отмена» была голым текстом в Pressable — без отклика на нажатие
              и с зоной в размер букв. А «Отклонить» рисовалась главной синей
              кнопкой, хотя по канону отклонение — это danger.
            */}
            <PrimaryButton title="Отмена" variant="ghost" compact onPress={onClose} />
            <PrimaryButton
              title="Отклонить"
              variant="danger"
              compact
              onPress={() => { onConfirm(reason.trim() || 'Требуется доработка'); setReason(''); }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const s = StyleSheet.create({
  overlay:{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', padding:24 },
  box:{ backgroundColor:RenovaTheme.colors.surface, borderRadius:12, padding:16 },
  head:{ fontWeight:'800', marginBottom:12 },
  input:{ borderWidth:1, borderColor:RenovaTheme.colors.border, borderRadius:8, padding:10, minHeight:80, marginBottom:12 },
  row:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', gap:12 },
});
