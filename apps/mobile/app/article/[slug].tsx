import { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { RenovaTheme } from '@/constants/Theme';
import { api, ArticleDetail } from '@/lib/api';
import { reportError } from '@/lib/reportError';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { articleViewState } from '@/lib/domain/articleListState';

export default function ArticleScreen() {
  const { slug, returnTo } = useLocalSearchParams<{ slug: string; returnTo?: string }>();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!slug) return;
    setError(null);
    api.getArticle(slug).then(setArticle).catch((e: unknown) => {
      reportError('app.article.slug.load', e, { slug });
      setError(e);
    });
  }, [slug, attempt]);

  const state = articleViewState({ loading: !article, error, hasArticle: !!article });
  if (!article) {
    return (
      <>
        <BackHeader title="Статья" returnTo={returnTo} />
        {state === 'loading' ? (
          <View style={styles.center}><ActivityIndicator color={RenovaTheme.colors.primary} /></View>
        ) : state === 'not_found' ? (
          <LoadErrorState title="Статья не найдена" hint="Возможно, её сняли с публикации." onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <LoadErrorState title="Не удалось загрузить статью" onRetry={() => setAttempt((n) => n + 1)} />
        )}
      </>
    );
  }

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
