import { useState } from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { RejectTemplates } from '@/components/renova/RejectTemplates';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { normalizeReturnReason } from '@/lib/domain/acceptanceActions';
import { shouldCloseAfterReturn, type ReturnResult } from '@/lib/returnModalFlow';
import { reportCatch } from '@/lib/reportError';

/**
 * Возврат этапа на доработку: причина обязательна — исполнитель увидит её на этапе.
 * Шторка остаётся открытой, пока идёт запрос; при ошибке (onConfirm → false) причина сохраняется.
 */
export function RejectStageModal({
  visible,
  stageName,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  stageName: string;
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
      reportCatch('components.renova.RejectStageModal.confirm')(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SheetSurface
      visible={visible}
      onClose={close}
      busy={busy}
      title={`Вернуть на доработку: ${stageName}`}
      footer={
        <>
          <PrimaryButton title="Вернуть" variant="accent" loading={busy} disabled={!clean} onPress={() => { void submit(); }} />
          <PrimaryButton title="Отмена" variant="ghost" disabled={busy} onPress={close} />
        </>
      }
    >
      <RejectTemplates onPick={setReason} />
      <TextInput
        style={[sheetContentStyles.input, s.input]}
        placeholder="Что нужно исправить (обязательно)…"
        value={reason}
        onChangeText={setReason}
        multiline
        editable={!busy}
      />
      {!clean ? <Text style={s.hint}>Опишите, что переделать — исполнитель увидит это в задаче.</Text> : null}
    </SheetSurface>
  );
}
const s = StyleSheet.create({
  input: { minHeight: 80, textAlignVertical: 'top' },
  hint: { color: RenovaTheme.colors.textMuted, fontSize: RenovaTheme.fontSize.bodySmall },
});
