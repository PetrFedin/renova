/** Заказчик: гостевой доступ (только просмотр) */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { apiErrorMessage, normalizePhoneInput } from '@/lib/formatPhone';
import { shareRenovaLink } from '@/lib/messengerShare';
import { alertViewerGuestAdded } from '@/lib/shareAccessNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError } from '@/lib/reportError';

type V = { user_id: string; phone: string; full_name?: string; role: string };
type ViewerAction = 'add' | `link:${string}` | `remove:${string}`;

export function ViewerSharePanel({
  userId,
  projectId,
  embedded,
}: {
  userId: string;
  projectId: string;
  embedded?: boolean;
}) {
  const { user, activeProject } = useRenova();
  const syncAfter = () => syncProjectSideEffects({
    user: user ?? ({ id: userId } as any),
    project: activeProject ?? ({ id: projectId } as any),
  });
  const [items, setItems] = useState<V[]>([]);
  const [phone, setPhone] = useState('');
  const [profileCode, setProfileCode] = useState('');
  const [busyAction, setBusyAction] = useState<ViewerAction | null>(null);
  const busyRef = useRef(false);
  const busy = busyAction !== null;

  const load = useCallback(() => {
    api.listViewers(userId, projectId).then(setItems).catch((e) => { reportError('components.renova.ViewerSharePanel.Items', e); setItems([]); });
  }, [userId, projectId]);
  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);

  const runAction = useCallback(async (action: ViewerAction, task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyAction(action);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setBusyAction(null);
    }
  }, []);

  const addGuest = async () => {
    const trimmedPhone = normalizePhoneInput(phone);
    const code = profileCode.trim().toUpperCase();
    if (!trimmedPhone && !code) {
      showActionConfirm({
        title: 'Контакт',
        message: 'Введите телефон или код профиля.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
      return;
    }
    await runAction('add', async () => {
      try {
        await api.shareViewer(userId, projectId, {
          phone: trimmedPhone || undefined,
          profile_code: code || undefined,
        });
        setPhone('');
        setProfileCode('');
        await syncAfter();
        load();
        alertViewerGuestAdded('customer');
      } catch (e: unknown) {
        showActionConfirm({
          title: 'Не удалось добавить',
          message: apiErrorMessage(e, 'Пользователь должен быть в Renova'),
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
      }
    });
  };

  const shareViewerPortal = async (viewer: V) => {
    await runAction(`link:${viewer.user_id}`, async () => {
      try {
        const link = await api.createViewerPortalLink(userId, projectId, viewer.user_id);
        await shareRenovaLink(link.url, 'портал объекта (гость)');
      } catch (e: unknown) {
        showActionConfirm({
          title: 'Портал',
          message: apiErrorMessage(e, 'Не удалось создать ссылку'),
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
      }
    });
  };

  const confirmRemoveViewer = (viewer: V) => {
    if (busyRef.current) return;
    showActionConfirm({
      title: 'Удалить гостя?',
      message: `${viewer.full_name || viewer.phone} потеряет доступ к просмотру объекта. Существующие ссылки перестанут давать доступ после проверки сервером.`,
      primaryLabel: 'Удалить доступ',
      primaryDestructive: true,
      onPrimary: () => {
        void runAction(`remove:${viewer.user_id}`, async () => {
          try {
            await api.removeViewer(userId, projectId, viewer.user_id);
            await syncAfter();
            load();
          } catch (e: unknown) {
            showActionConfirm({
              title: 'Ошибка',
              message: apiErrorMessage(e, 'Не удалось удалить гостевой доступ'),
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          }
        });
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  return (
    <View style={[s.box, embedded && s.embedded]}>
      {items.length ? (
        <View style={s.list}>
          {items.map((v) => {
            const linkBusy = busyAction === `link:${v.user_id}`;
            const removeBusy = busyAction === `remove:${v.user_id}`;
            return (
              <View key={v.user_id} style={s.row}>
                <View style={s.meta}>
                  <Text style={s.name}>{v.full_name || 'Гость'}</Text>
                  <Text style={s.phone}>{v.phone}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Поделиться ссылкой портала для ${v.full_name || v.phone}`}
                  disabled={busy}
                  style={({ pressed }) => [s.linkBtn, (pressed || linkBusy) && s.pressed, busy && !linkBusy && s.disabled]}
                  onPress={() => { void shareViewerPortal(v); }}
                >
                  {linkBusy ? <ActivityIndicator size="small" color={RenovaTheme.colors.primary} /> : <Text style={s.linkBtnT}>🔗</Text>}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Удалить гостевой доступ для ${v.full_name || v.phone}`}
                  disabled={busy}
                  style={({ pressed }) => [s.remove, (pressed || removeBusy) && s.pressed, busy && !removeBusy && s.disabled]}
                  onPress={() => confirmRemoveViewer(v)}
                >
                  {removeBusy ? <ActivityIndicator size="small" color={RenovaTheme.colors.danger} /> : <Text style={s.removeT}>✕</Text>}
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : (
        <>
          <Text style={s.empty}>Нет гостей</Text>
          <Text style={s.hint}>
            Ссылка портала шарится через систему (WhatsApp / Telegram). Отдельного WA Business API в MVP нет.
          </Text>
        </>
      )}

      <View style={s.addBlock}>
        <Text style={s.addLabel}>Добавить гостя</Text>
        <TextInput
          style={s.inp}
          value={phone}
          onChangeText={setPhone}
          placeholder="Телефон"
          keyboardType="phone-pad"
          editable={!busy}
        />
        <Text style={s.or}>или</Text>
        <TextInput
          style={s.inp}
          value={profileCode}
          onChangeText={setProfileCode}
          placeholder="Код профиля"
          autoCapitalize="characters"
          maxLength={6}
          editable={!busy}
        />
        <PrimaryButton
          title="Добавить"
          variant="outline"
          loading={busyAction === 'add'}
          disabled={busy && busyAction !== 'add'}
          onPress={() => { void addGuest(); }}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: RenovaTheme.radius.lg,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  embedded: {
    marginBottom: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  list: { gap: 0, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: RenovaTheme.minTouch,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: RenovaTheme.colors.borderLight,
  },
  meta: { flex: 1, paddingRight: 8 },
  name: { fontWeight: '600', fontSize: 15, color: RenovaTheme.colors.text },
  phone: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, lineHeight: 15, marginBottom: 8 },
  empty: { fontSize: 14, color: RenovaTheme.colors.textMuted, marginBottom: 12 },
  addBlock: { gap: 8 },
  addLabel: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text },
  or: { fontSize: 12, color: RenovaTheme.colors.textSubtle, textAlign: 'center' },
  remove: {
    width: RenovaTheme.minTouch,
    height: RenovaTheme.minTouch,
    borderRadius: RenovaTheme.minTouch / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
  },
  linkBtn: {
    width: RenovaTheme.minTouch,
    height: RenovaTheme.minTouch,
    borderRadius: RenovaTheme.minTouch / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E0F2FE',
    marginRight: 6,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  linkBtnT: { fontSize: 14 },
  removeT: { color: '#B91C1C', fontWeight: '800', fontSize: 14 },
  inp: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.md,
    padding: 12,
    fontSize: 15,
    backgroundColor: RenovaTheme.colors.surface,
  },
});
