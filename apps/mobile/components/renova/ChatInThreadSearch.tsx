import { useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { TextInput, View, Text, Pressable, StyleSheet } from 'react-native';
import { HighlightText } from '@/components/renova/HighlightText';

type SearchableMessage = { id: string; text: string | null };
type SearchHit = { id: string; text: string };

export function ChatInThreadSearch({
  messages,
  onJump,
  onQueryChange,
}: {
  messages: SearchableMessage[];
  onJump: (id: string) => void;
  onQueryChange?: (q: string) => void;
}) {
  const [q, setQ] = useState('');
  const normalizedQuery = q.trim().toLowerCase();
  const hits: SearchHit[] = normalizedQuery
    ? messages
      .filter((message): message is SearchHit => (
        typeof message.text === 'string'
        && message.text.toLowerCase().includes(normalizedQuery)
      ))
      .slice(0, 5)
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
  wrap: { marginBottom: 8 },
  input: {
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  hit: { padding: 6, fontSize: 12, color: '#2563eb' },
});
