import { useEffect, useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { TextInput, View, Text, Pressable, StyleSheet } from 'react-native';
import { HighlightText } from '@/components/renova/HighlightText';

type SearchableMessage = { id: string; text: string | null };
type SearchHit = { id: string; text: string };

export function ChatInThreadSearch({
  messages,
  onJump,
  onQueryChange,
  fetchRemote,
}: {
  messages: SearchableMessage[];
  onJump: (id: string) => void;
  onQueryChange?: (q: string) => void;
  /** Серверный поиск по всей истории (в окне загружена только её часть). */
  fetchRemote?: (q: string) => Promise<SearchHit[]>;
}) {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<SearchHit[]>([]);
  const normalizedQuery = q.trim().toLowerCase();

  useEffect(() => {
    if (!fetchRemote || !normalizedQuery) {
      setRemote([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchRemote(q.trim())
        .then((rows) => { if (!cancelled) setRemote(rows); })
        .catch(() => { if (!cancelled) setRemote([]); });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedQuery, fetchRemote]);

  const local: SearchHit[] = normalizedQuery
    ? messages.filter((message): message is SearchHit => (
      typeof message.text === 'string'
      && message.text.toLowerCase().includes(normalizedQuery)
    ))
    : [];
  const seen = new Set<string>();
  const hits: SearchHit[] = normalizedQuery
    ? [...remote, ...local].filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true))).slice(0, 5)
    : [];

  return (
    <View style={s.wrap}>
      <TextInput
        style={s.input}
        placeholder="Поиск в чате…"
        value={q}
        onChangeText={(value: string) => {
          setQ(value);
          onQueryChange?.(value);
        }}
      />
      {hits.map((message) => (
        <Pressable key={message.id} onPress={() => onJump(message.id)}>
          <Text style={s.hit} numberOfLines={1}>
            <HighlightText text={message.text} query={q} />
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 8, marginHorizontal: 16 },
  input: {
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  hit: { padding: 6, fontSize: 12, color: '#2563eb' },
});
