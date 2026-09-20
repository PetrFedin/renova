/**
 * Удаление аккаунта — вход к `DELETE /api/v1/auth/me`.
 *
 * Маршрут есть на сервере: обезличивает профиль, помечает удалённым, закрывает
 * все сессии и возвращает срок хранения. В приложении входа к нему не было.
 * Без него приложение с учётными записями не проходит ревью App Store.
 */
import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError } from '@/lib/reportError';
import {
  DELETE_CONFIRM_WORD,
  DELETE_CONSEQUENCES,
  deleteConfirmMatches,
  retentionNotice,
} from '@/lib/domain/accountDeletion';

export function AccountDeleteBlock({
  userId,
  onDeleted,
}: {
  userId: string;
  onDeleted: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function runDelete() {
    setBusy(true);
    try {
      const result = await api.deleteMe(userId);
      showActionConfirm({
        title: 'Аккаунт удалён',
        message: retentionNotice(result.retention_until),
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
      await onDeleted();
    } catch (error) {
      reportError('account.delete', error, { userId });
      showActionConfirm({
        title: 'Аккаунт не удалён',
        message: error instanceof Error ? error.message : 'Проверьте связь и повторите.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <PrimaryButton
        title="Удалить аккаунт"
        variant="outline"
        accessibilityLabel="Удалить аккаунт"
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <View style={s.box}>
      <Text style={s.title}>Что произойдёт</Text>
      {DELETE_CONSEQUENCES.map((line) => (
        <Text key={line} style={s.line}>• {line}</Text>
      ))}
      <Text style={s.label}>
        Введите «{DELETE_CONFIRM_WORD}», чтобы подтвердить
      </Text>
      <TextInput
        value={confirmText}
        onChangeText={setConfirmText}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={DELETE_CONFIRM_WORD}
        placeholderTextColor={RenovaTheme.colors.textSubtle}
        accessibilityLabel={`Подтверждение удаления: введите ${DELETE_CONFIRM_WORD}`}
        style={s.input}
        editable={!busy}
      />
      <PrimaryButton
        title="Удалить аккаунт навсегда"
        loading={busy}
        disabled={busy || !deleteConfirmMatches(confirmText)}
        accessibilityLabel="Удалить аккаунт навсегда"
        onPress={() => { void runDelete(); }}
      />
      <PrimaryButton
        title="Отмена"
        variant="outline"
        disabled={busy}
        onPress={() => { setOpen(false); setConfirmText(''); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    gap: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.dangerBorder,
    backgroundColor: RenovaTheme.colors.dangerBg,
    borderRadius: RenovaTheme.radius.sm,
    padding: 12,
  },
  title: { fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  line: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.text, lineHeight: 18 },
  label: { marginTop: 4, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.sm,
    paddingHorizontal: 12,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.surface,
  },
});
