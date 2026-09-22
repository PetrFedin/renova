/** Возврат дизайн-пакета на доработку — причина уходит автору пакета. */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';

/** Подсказки под дизайн, а не под приёмку работ: причины у них разные. */
const TEMPLATES = [
  'Не та планировка',
  'Поменять материалы или цвета',
  'Не хватает развёрток',
  'Расходится со сметой',
];

export function DesignRejectModal({
  visible,
  packageTitle,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  packageTitle: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  const confirm = () => {
    onConfirm(reason.trim() || 'Требуется доработка');
    setReason('');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.box}>
          <Text style={s.head}>Вернуть на доработку: {packageTitle}</Text>
          <Text style={s.hint}>
            Причина придёт автору пакета уведомлением и останется в ленте проекта.
          </Text>
          <View style={s.chips}>
            {TEMPLATES.map((template) => (
              <Pressable
                key={template}
                accessibilityRole="button"
                accessibilityLabel={`Причина: ${template}`}
                style={s.chip}
                onPress={() => setReason(template)}
              >
                <Text style={s.chipT}>{template}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={s.input}
            placeholder="Что именно переделать…"
            value={reason}
            onChangeText={setReason}
            accessibilityLabel="Причина доработки дизайна"
            multiline
          />
          <View style={s.row}>
            <PrimaryButton title="Отмена" variant="ghost" compact onPress={onClose} />
            <PrimaryButton title="Вернуть на доработку" compact onPress={confirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: RenovaTheme.spacing.xxl,
  },
  box: {
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: RenovaTheme.radius.lg,
    padding: RenovaTheme.spacing.lg,
    gap: RenovaTheme.spacing.sm,
  },
  head: { ...screenTypography.section, marginTop: 0 },
  hint: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.xs },
  chip: {
    backgroundColor: RenovaTheme.colors.dangerBg,
    paddingHorizontal: RenovaTheme.spacing.md,
    minHeight: RenovaTheme.minTouch,
    justifyContent: 'center',
    borderRadius: RenovaTheme.radius.pill,
  },
  chipT: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.dangerText },
  input: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.sm,
    padding: RenovaTheme.spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: RenovaTheme.fontSize.body,
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: RenovaTheme.spacing.sm },
});
