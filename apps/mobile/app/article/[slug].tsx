import { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { RenovaTheme } from '@/constants/Theme';
import { api, ArticleDetail } from '@/lib/api';
import { reportCatch } from '@/lib/reportError';

export default function ArticleScreen() {
  const { slug, returnTo } = useLocalSearchParams<{ slug: string; returnTo?: string }>();
  const [article, setArticle] = useState<ArticleDetail | null>(null);

  useEffect(() => {
    if (slug) api.getArticle(slug).then(setArticle).catch(reportCatch('app.article.slug.1'));
  }, [slug]);

  if (!article) return <View style={styles.center}><Text>Загрузка…</Text></View>;

  return (
    <>
      <BackHeader title={article.title} returnTo={returnTo} subtitle={article.category_label} />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.title}>{article.title}</Text>
        <Text style={styles.meta}>{article.read_min} мин чтения</Text>
        {article.body.split('\n').map((line, i) => (
          <Text key={i} style={styles.p}>{line}</Text>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  meta: { color: RenovaTheme.colors.textMuted, marginBottom: 16 },
  p: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
});
