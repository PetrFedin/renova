/** Гид по ремонту — статьи для заказчика и исполнителя */
import { useEffect, useState } from 'react';
import { ScrollView, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { api, ArticleSummary } from '@/lib/api';
import { useNavFromHere } from '@/lib/navigation';

export function GuideScreen() {
  const nav = useNavFromHere();
  const [articles, setArticles] = useState<ArticleSummary[]>([]);

  useEffect(() => { api.listArticles().then(setArticles).catch(() => {}); }, []);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
      <Text style={styles.head}>Гид по ремонту</Text>
      <Text style={styles.sub}>Статьи: замеры, электрика, приёмка, оплаты</Text>
      {articles.map((a) => (
        <Pressable key={a.slug} style={styles.card} onPress={() => nav.article(a.slug)}>
          <Text style={styles.cat}>{a.category_label}</Text>
          <Text style={styles.title}>{a.title}</Text>
          <Text style={styles.summary}>{a.summary}</Text>
          <Text style={styles.meta}>{a.read_min} мин · {a.tags.join(', ')}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  head: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  sub: { color: RenovaTheme.colors.textMuted, marginBottom: 16, fontSize: 13 },
  card: { backgroundColor: RenovaTheme.colors.surface, padding: 14, borderRadius: 12, marginBottom: 10 },
  cat: { fontSize: 11, color: RenovaTheme.colors.primary, fontWeight: '700', textTransform: 'uppercase' },
  title: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  summary: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 6 },
  meta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 8 },
});
