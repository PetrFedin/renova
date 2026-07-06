/** Заказчик: гостевой доступ (read-only) — без отдельной роли */
import { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable, ActivityIndicator } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
import { api } from '@/lib/api';
import { apiErrorMessage, normalizePhoneInput } from '@/lib/formatPhone';

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
  const [items, setItems] = useState<V[]>([]);
  const [phone, setPhone] = useState('');
  const [profileCode, setProfileCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.listViewers(userId, projectId).then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, [userId, projectId]);

  const addGuest = async () => {
    const trimmedPhone = normalizePhoneInput(phone);
    const code = profileCode.trim().toUpperCase();
    if (!trimmedPhone && !code) {
      Alert.alert('Контакт', 'Введите телефон или код профиля гостя');
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
      load();
      Alert.alert('Гость добавлен', 'Доступ только для просмотра объекта.');
    } catch (e: unknown) {
      Alert.alert(
        'Не удалось добавить',
        apiErrorMessage(
          e,
          'Пользователь должен войти в Renova. Demo-гость: +70000000003 или код профиля из «Профиль».',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.box, embedded && s.embedded]}>
      {!embedded ? (
        <>
          <Text style={s.head}>Гостевой доступ</Text>
          <Text style={formMetaText.caption}>Только просмотр — семья или дизайнер видят объект без редактирования</Text>
        </>
      ) : (
        <>
          <Text style={s.subHead}>Гостевой доступ</Text>
          <Text style={[formMetaText.caption, s.subHintSpaced]}>Только просмотр — без редактирования</Text>
        </>
      )}

      {items.length ? (
        items.map((v) => (
          <View key={v.user_id} style={s.row}>
            <View style={s.meta}>
              <Text style={s.name}>{v.full_name || 'Гость'}</Text>
              <Text style={formMetaText.caption}>{v.phone}</Text>
            </View>
            <Pressable
              accessibilityLabel="Удалить гостя"
              style={s.remove}
              onPress={async () => {
                try {
                  await api.removeViewer(userId, projectId, v.user_id);
                  load();
                } catch (e: unknown) {
                  Alert.alert('Ошибка', apiErrorMessage(e, 'Не удалось удалить гостя'));
                }
              }}
            >
              <Text style={s.removeT}>✕</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Text style={formMetaText.caption}>Гостей пока нет</Text>
      )}

      <Text style={[formMetaText.caption, s.fieldHint]}>Demo: +70000000003 · или код профиля из «Профиль»</Text>
      <TextInput
        style={s.inp}
        value={phone}
        onChangeText={setPhone}
        placeholder="Телефон +7…"
        keyboardType="phone-pad"
        editable={!busy}
      />
      <TextInput
        style={s.inp}
        value={profileCode}
        onChangeText={setProfileCode}
        placeholder="Код профиля (6 символов)"
        autoCapitalize="characters"
        editable={!busy}
      />
      <PrimaryButton
        title={busy ? 'Добавление…' : 'Добавить гостя'}
        variant="outline"
        disabled={busy}
        onPress={addGuest}
      />
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
  head: { fontWeight: '800', marginBottom: 4, fontSize: 15 },
  subHead: { fontWeight: '700', marginBottom: 2, fontSize: 14 },
  subHintSpaced: { marginBottom: 8 },
  fieldHint: { marginTop: 8, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
  },
  meta: { flex: 1, paddingRight: 8 },
  name: { fontWeight: '600', fontSize: 14 },
  remove: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
  },
  removeT: { color: '#B91C1C', fontWeight: '800', fontSize: 14 },
  inp: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.md,
    padding: 10,
    marginBottom: 8,
    backgroundColor: RenovaTheme.colors.surface,
  },
  loader: { marginTop: 6 },
});
