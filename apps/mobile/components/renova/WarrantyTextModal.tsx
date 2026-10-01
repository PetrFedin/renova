import { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import {
  normalizeWarrantyComment,
  normalizeWarrantyForm,
  WARRANTY_COMMENT_MAX,
  WARRANTY_DESCRIPTION_MAX,
  WARRANTY_TITLE_MAX,
} from '@/lib/domain/warrantyForm';

type Props =
  | {
      mode: 'create';
      visible: boolean;
      onClose: () => void;
      onConfirm: (value: { title: string; description: string }) => void;
    }
  | {
      mode: 'comment';
      visible: boolean;
      heading: string;
      confirmLabel: string;
      required: boolean;
      onClose: () => void;
      onConfirm: (comment: string | undefined) => void;
    };

/** Гарантия: тема и описание дефекта (создание) либо комментарий к ответу / повторному открытию. */
export function WarrantyTextModal(props: Props) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const reset = () => { setTitle(''); setText(''); };
  const close = () => { reset(); props.onClose(); };

  if (props.mode === 'create') {
    const form = normalizeWarrantyForm(title, text);
    return (
      <Modal visible={props.visible} transparent animationType="fade" onRequestClose={close}>
        <View style={s.overlay}>
          <View style={s.box}>
            <Text style={s.head}>Гарантийное обращение</Text>
            <TextInput
              style={s.line}
              placeholder="Что случилось (тема)"
              value={title}
              onChangeText={setTitle}
              maxLength={WARRANTY_TITLE_MAX}
            />
            <TextInput
              style={s.input}
              placeholder="Опишите дефект: где, когда заметили, как проявляется"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={WARRANTY_DESCRIPTION_MAX}
            />
            {!form.ok ? <Text style={s.hint}>Нужны тема и описание — исполнитель увидит их в обращении.</Text> : null}
            <View style={s.row}>
              <Pressable onPress={close}><Text style={s.cancel}>Отмена</Text></Pressable>
              <PrimaryButton
                title="Создать"
                disabled={!form.ok}
                onPress={() => { if (!form.ok) return; props.onConfirm(form.value); reset(); }}
              />
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  const comment = normalizeWarrantyComment(text);
  const blocked = props.required && !comment;
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={close}>
      <View style={s.overlay}>
        <View style={s.box}>
          <Text style={s.head}>{props.heading}</Text>
          <TextInput
            style={s.input}
            placeholder={props.required ? 'Комментарий (обязательно)' : 'Комментарий (по желанию)'}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={WARRANTY_COMMENT_MAX}
          />
          {blocked ? <Text style={s.hint}>Укажите причину — вторая сторона увидит её в обращении.</Text> : null}
          <View style={s.row}>
            <Pressable onPress={close}><Text style={s.cancel}>Отмена</Text></Pressable>
            <PrimaryButton
              title={props.confirmLabel}
              disabled={blocked}
              onPress={() => { if (blocked) return; props.onConfirm(comment); reset(); }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 16 },
  head: { fontWeight: '800', marginBottom: 12 },
  line: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 10, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 10, minHeight: 80, marginBottom: 8 },
  hint: { color: RenovaTheme.colors.textMuted, fontSize: RenovaTheme.fontSize.bodySmall, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cancel: { color: RenovaTheme.colors.textMuted, padding: 8 },
});
