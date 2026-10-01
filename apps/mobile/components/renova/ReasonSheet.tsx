import { useState } from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { normalizeReturnReason } from '@/lib/domain/acceptanceActions';
import { shouldCloseAfterReturn, type ReturnResult } from '@/lib/returnModalFlow';
import { reportCatch } from '@/lib/reportError';

/**
 * Лист «укажите причину»: отклонение материала или позиции подбора.
 * Остаётся открытым, пока идёт запрос; при ошибке (onConfirm → false) причина сохраняется.
 */
export function ReasonSheet({
  visible,
  title,
  placeholder,
  hint,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  hint: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<ReturnResult> | ReturnResult;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = normalizeReturnReason(reason);
  const close = () => { if (busy) return; setReason(''); onClose(); };
  const submit = async () => {
    if (!clean || busy) return;
    setBusy(true);
    try {
      const result = await onConfirm(clean);
      if (shouldCloseAfterReturn(result)) { setReason(''); onClose(); }
    } catch (e) {
      reportCatch('components.renova.ReasonSheet.confirm')(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SheetSurface
      visible={visible}
      onClose={close}
      busy={busy}
      title={title}
      footer={
        <>
          <PrimaryButton title={confirmLabel} variant="accent" loading={busy} disabled={!clean} onPress={() => { void submit(); }} />
          <PrimaryButton title="Отмена" variant="ghost" disabled={busy} onPress={close} />
        </>
      }
    >
      <TextInput
        style={[sheetContentStyles.input, s.input]}
        placeholder={placeholder}
        value={reason}
        onChangeText={setReason}
        multiline
        editable={!busy}
      />
      {!clean ? <Text style={s.hint}>{hint}</Text> : null}
    </SheetSurface>
  );
}

const s = StyleSheet.create({
  input: { minHeight: 80, textAlignVertical: 'top' },
  hint: { color: RenovaTheme.colors.textMuted, fontSize: RenovaTheme.fontSize.bodySmall },
});
