/** Заказчик: гостевой доступ (read-only) — без отдельной роли */
import { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';

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

  const load = () => api.listViewers(userId, projectId).then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, [userId, projectId]);

  return (
    <View style={[s.box, embedded && s.embedded]}>
      {!embedded ? (
        <>
          <Text style={s.head}>Гостевой доступ</Text>
          <Text style={s.hint}>Только просмотр — семья или дизайнер видят объект без редактирования</Text>
        </>
      ) : (
        <>
          <Text style={s.subHead}>Гостевой доступ</Text>
          <Text style={s.subHint}>Только просмотр — без редактирования</Text>
        </>
      )}

      {items.length ? (
        items.map((v) => (
          <View key={v.user_id} style={s.row}>
            <View style={s.meta}>
              <Text style={s.name}>{v.full_name || 'Гость'}</Text>
              <Text style={s.phone}>{v.phone}</Text>
            </View>
            <Pressable
              accessibilityLabel="Удалить гостя"
              style={s.remove}
              onPress={async () => {
                await api.removeViewer(userId, projectId, v.user_id);
                load();
              }}
            >
              <Text style={s.removeT}>✕</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Text style={s.empty}>Гостей пока нет</Text>
      )}

      <TextInput
        style={s.inp}
        value={phone}
        onChangeText={setPhone}
        placeholder="+7..."
        keyboardType="phone-pad"
      />
      <PrimaryButton
        title="Добавить гостя"
        variant="outline"
        onPress={async () => {
          const trimmed = phone.trim();
          if (!trimmed) {
            Alert.alert('Телефон', 'Введите номер гостя');
            return;
          }
          try {
            await api.shareViewer(userId, projectId, trimmed);
            setPhone('');
            load();
          } catch {
            Alert.alert('Не найден', 'Пользователь должен войти в Renova (demo или SMS)');
          }
        }}
      />
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
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 10, lineHeight: 16 },
  subHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 16 },
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
  phone: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  remove: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
  },
  removeT: { color: '#B91C1C', fontWeight: '800', fontSize: 14 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  inp: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.md,
    padding: 10,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: RenovaTheme.colors.surface,
  },
});
