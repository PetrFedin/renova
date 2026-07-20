/** Заказчик: гостевой доступ (только просмотр) */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable, ActivityIndicator } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { apiErrorMessage, normalizePhoneInput } from '@/lib/formatPhone';
import { shareRenovaLink } from '@/lib/messengerShare';

type V = { user_id: string; phone: string; full_name?: string; role: string };

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
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listViewers(userId, projectId).then(setItems).catch(() => setItems([]));
  }, [userId, projectId]);
  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);

  const addGuest = async () => {
    const trimmedPhone = normalizePhoneInput(phone);
    const code = profileCode.trim().toUpperCase();
    if (!trimmedPhone && !code) {
      Alert.alert('Контакт', 'Введите телефон или код профиля');
      return;
    }
    setBusy(true);
    try {
      await api.shareViewer(userId, projectId, {
        phone: trimmedPhone || undefined,
        profile_code: code || undefined,
      });
      setPhone('');
      setProfileCode('');
      await syncAfter();
      load();
    } catch (e: unknown) {
      Alert.alert('Не удалось добавить', apiErrorMessage(e, 'Пользователь должен быть в Renova'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.box, embedded && s.embedded]}>
      {items.length ? (
        <View style={s.list}>
          {items.map((v) => (
            <View key={v.user_id} style={s.row}>
              <View style={s.meta}>
                <Text style={s.name}>{v.full_name || 'Гость'}</Text>
                <Text style={s.phone}>{v.phone}</Text>
              </View>
              <Pressable
                accessibilityLabel="Ссылка портала"
                style={s.linkBtn}
                onPress={async () => {
                  try {
                    const link = await api.createViewerPortalLink(userId, projectId, v.user_id);
                    await shareRenovaLink(link.url, 'портал объекта (гость)');
                  } catch (e: unknown) {
                    Alert.alert('Портал', apiErrorMessage(e, 'Не удалось создать ссылку'));
                  }
                }}
              >
                <Text style={s.linkBtnT}>🔗</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Удалить гостя"
                style={s.remove}
                onPress={async () => {
                  try {
                    await api.removeViewer(userId, projectId, v.user_id);
                    await syncAfter();
                    load();
                  } catch (e: unknown) {
                    Alert.alert('Ошибка', apiErrorMessage(e, 'Не удалось удалить'));
                  }
                }}
              >
                <Text style={s.removeT}>✕</Text>
              </Pressable>
            </View>
          ))}
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
          title={busy ? '…' : 'Добавить'}
          variant="outline"
          disabled={busy}
          onPress={addGuest}
        />
      </View>
      {busy ? <ActivityIndicator style={s.loader} color={RenovaTheme.colors.primary} /> : null}
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
    paddingVertical: 10,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
  },
  linkBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E0F2FE',
    marginRight: 6,
  },
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
  loader: { marginTop: 6 },
});
