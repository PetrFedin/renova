/** Подписка на календарь: адрес ленты для Google/Apple Calendar. */
import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { api } from '@/lib/api';
import { confirmDestructive } from '@/lib/confirmAlert';
import { apiErrorMessage } from '@/lib/formatPhone';
import { reportError } from '@/lib/reportError';

type PropagationEvent = { stopPropagation?: () => void };

export function CalendarSubscriptionSheet({
  visible,
  userId,
  onClose,
}: {
  visible: boolean;
  userId: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const state = await api.calendarSubscription(userId);
      setUrl(state.url);
    } catch (error: unknown) {
      reportError('schedule.CalendarSubscriptionSheet.load', error);
      showActionConfirm({
        title: 'Подписка недоступна',
        message: apiErrorMessage(error, 'Не удалось узнать состояние подписки.'),
      });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const run = async (action: () => Promise<{ url: string | null }>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const state = await action();
      setUrl(state.url);
    } catch (error: unknown) {
      showActionConfirm({ title: failure, message: apiErrorMessage(error, 'Повторите действие.') });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    showActionConfirm({
      title: 'Ссылка скопирована',
      message: 'Вставьте её в календарь: «Другие календари» → «Подписаться по URL».',
    });
  };

  const rotate = async () => {
    const ok = await confirmDestructive(
      'Перевыпустить ссылку?',
      'Прежний адрес перестанет открываться. Календари, подписанные на него, перестанут обновляться, пока не подпишутся на новый.',
    );
    if (!ok) return;
    await run(() => api.issueCalendarSubscription(userId, true), 'Ссылка не перевыпущена');
  };

  const revoke = async () => {
    const ok = await confirmDestructive(
      'Отключить подписку?',
      'Адрес перестанет открываться. Календари, подписанные на него, больше не получат события.',
    );
    if (!ok) return;
    await run(() => api.revokeCalendarSubscription(userId), 'Подписка не отключена');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(event: PropagationEvent) => event.stopPropagation?.()}>
          <Text style={s.head}>Подписка на календарь</Text>
          <Text style={s.hint}>
            Ссылка отдаёт ваши события в Google Calendar, Apple Calendar и любой другой календарь,
            который умеет подписываться по адресу. События обновляются сами.
          </Text>

          {loading ? <ActivityIndicator /> : null}

          {!loading && url ? (
            <>
              <Text style={s.url} selectable numberOfLines={3}>{url}</Text>
              <Text style={s.warn}>
                Кто получит ссылку, увидит ваш календарь без входа в приложение. Делитесь ей как паролем.
              </Text>
              <PrimaryButton title="Скопировать ссылку" onPress={() => { void copy(); }} disabled={busy} fullWidth />
              <PrimaryButton
                title={busy ? 'Обновление…' : 'Перевыпустить'}
                variant="outline"
                onPress={() => { void rotate(); }}
                disabled={busy}
                fullWidth
              />
              <PrimaryButton
                title="Отключить подписку"
                variant="ghost"
                onPress={() => { void revoke(); }}
                disabled={busy}
                fullWidth
              />
            </>
          ) : null}

          {!loading && !url ? (
            <>
              <Text style={s.hint}>Подписка не заведена — ссылки пока не существует.</Text>
              <PrimaryButton
                title={busy ? 'Создание…' : 'Создать ссылку'}
                onPress={() => { void run(() => api.issueCalendarSubscription(userId), 'Ссылка не создана'); }}
                disabled={busy}
                fullWidth
              />
            </>
          ) : null}

          <PrimaryButton title="Закрыть" variant="outline" onPress={onClose} disabled={busy} fullWidth />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: RenovaTheme.radius.xl,
    borderTopRightRadius: RenovaTheme.radius.xl,
    padding: RenovaTheme.spacing.md,
    paddingBottom: RenovaTheme.spacing.xl,
    gap: RenovaTheme.spacing.sm,
  },
  head: { ...screenTypography.section, marginTop: 0 },
  hint: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  url: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
    borderRadius: RenovaTheme.radius.sm,
    padding: RenovaTheme.spacing.sm,
  },
  warn: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.dangerText },
});
