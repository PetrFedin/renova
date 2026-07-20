/** Шаблоны чеклиста приёмки — из профиля исполнителя */
import { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { BackHeader } from '@/components/renova/BackHeader';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api } from '@/lib/api';

type Tpl = { id: string; name: string; items: string[] };

export default function ChecklistTemplatesScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useRenova();
  const [items, setItems] = useState<Tpl[]>([]);
  const [name, setName] = useState('');
  const [lines, setLines] = useState('');

  const reload = useCallback(() => {
    if (!user) return;
    api.listChecklistTemplates(user.id).then(setItems).catch(() => setItems([]));
  }, [user?.id]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useProjectDataReload(reload);

  async function save() {
    if (!user || !name.trim()) {
      Alert.alert('Шаблон', 'Введите название');
      return;
    }
    const parsed = lines.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!parsed.length) {
      Alert.alert('Шаблон', 'Добавьте пункты чеклиста (по одному на строку)');
      return;
    }
    try {
      await api.saveChecklistTemplate(user.id, name.trim(), parsed);
      setName('');
      setLines('');
      reload();
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить шаблон');
    }
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <BackHeader title="Шаблоны чеклиста" />
      {!user ? <Text style={s.muted}>Войдите в аккаунт</Text> : (
        <>
          <Text style={s.hint}>Пункты для приёмки этапов. Один пункт — одна строка.</Text>
          <TextInput style={s.input} placeholder="Название шаблона" value={name} onChangeText={setName} />
          <TextInput
            style={[s.input, s.area]}
            placeholder={'Качество OK\nФото приложены\n…'}
            value={lines}
            onChangeText={setLines}
            multiline
          />
          <PrimaryButton title="Сохранить шаблон" onPress={save} />
          <Text style={s.section}>Сохранённые ({items.length})</Text>
          {!items.length && <Text style={s.muted}>Пока нет шаблонов</Text>}
          {items.map((t) => (
            <View key={t.id} style={s.card}>
              <Text style={s.title}>{t.name}</Text>
              {t.items.map((it, i) => (
                <Text key={`${t.id}-${i}`} style={s.item}>· {it}</Text>
              ))}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  hint: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: RenovaTheme.colors.surface },
  area: { minHeight: 100, textAlignVertical: 'top' },
  section: { fontWeight: '700', marginTop: 20, marginBottom: 8 },
  card: { ...card, marginBottom: 8 },
  title: { fontWeight: '700', fontSize: 15, marginBottom: 6 },
  item: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  muted: { color: RenovaTheme.colors.textMuted },
});
