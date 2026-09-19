import { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { RejectTemplates } from '@/components/renova/RejectTemplates';
import { PrimaryButton } from '@/components/renova/PrimaryButton';

export function RejectStageModal({
  visible,
  stageName,
  onClose,
  onConfirm,
  title,
  placeholder,
  fallbackReason = 'Требуется доработка',
  showTemplates = true,
}: {
  visible: boolean;
  stageName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  /** Заголовок целиком — когда отклоняют не этап. */
  title?: string;
  placeholder?: string;
  /** Что отправить, если пользователь ничего не написал. */
  fallbackReason?: string;
  /** Быстрые причины осмысленны для этапа, но не для материала. */
  showTemplates?: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.box}>
          <Text style={s.head}>{title ?? `Отклонить: ${stageName}`}</Text>
          {showTemplates ? <RejectTemplates onPick={setReason} /> : null}
          <TextInput
            style={s.input}
            placeholder={placeholder ?? 'Причина доработки…'}
            value={reason}
            onChangeText={setReason}
            multiline
            accessibilityLabel={placeholder ?? 'Причина доработки'}
          />
          <View style={s.row}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Отмена">
              <Text style={s.cancel}>Отмена</Text>
            </Pressable>
            <PrimaryButton
              title="Отклонить"
              accessibilityLabel="Отклонить"
              onPress={() => { onConfirm(reason.trim() || fallbackReason); setReason(''); }}
            />
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
  input:{ borderWidth:1, borderColor:RenovaTheme.colors.border, borderRadius:8, padding:10, minHeight:80, marginBottom:12 },
  row:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  cancel:{ color: RenovaTheme.colors.textMuted, padding:8 },
});
