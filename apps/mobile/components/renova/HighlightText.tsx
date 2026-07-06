/** Подсветка совпадений в тексте чата */
import { Text } from 'react-native';

export function HighlightText({ text, query }: { text: string; query?: string }) {
  if (!query?.trim()) return <Text>{text}</Text>;
  const q = query.trim().toLowerCase();
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <Text>{text}</Text>;
  return (
    <Text>
      {text.slice(0, i)}
      <Text style={{ backgroundColor: '#fef08a', fontWeight: '700' }}>{text.slice(i, i + q.length)}</Text>
      {text.slice(i + q.length)}
    </Text>
  );
}
