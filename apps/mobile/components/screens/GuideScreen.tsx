/** Гид по ремонту — статьи для заказчика и исполнителя */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { api, ArticleSummary } from '@/lib/api';
import { useNavFromHere } from '@/lib/navigation';
import { reportError } from '@/lib/reportError';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { categoryChips, listViewState } from '@/lib/domain/articleListState';

export function GuideScreen() {
  const nav = useNavFromHere();
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setArticles(await api.listArticles(category ?? undefined));
      setError(false);
      setLoadedOnce(true);
    } catch (e) {
      reportError('components.screens.GuideScreen.load', e, { category });
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // Категории — необязательное украшение: без них фильтра просто нет.
    api.listArticleCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const state = listViewState({ loading, error, count: articles.length, loadedOnce });

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
      <Text style={styles.head}>Гид по ремонту</Text>
      <Text style={styles.sub}>Статьи: замеры, электрика, приёмка, оплаты</Text>
      {categories.length > 0 ? (
        <View style={styles.chips}>
          {categoryChips(categories).map((c) => {
            const on = category === c.id;
            return (
              <Pressable key={c.id ?? 'all'} style={[styles.chip, on && styles.chipOn]} onPress={() => setCategory(c.id)} accessibilityRole="button">
                <Text style={[styles.chipT, on && styles.chipTOn]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {state === 'loading' ? <ActivityIndicator color={RenovaTheme.colors.primary} style={{ marginVertical: 16 }} /> : null}
      {state === 'error' ? (
        <LoadErrorState title="Не удалось загрузить статьи" hint="Пустой список не означает, что статей нет. Повторите." onRetry={() => void load()} />
      ) : null}
      {state === 'empty' ? (
        <EmptyActionState
          title="Статей пока нет"
          hint={category ? 'В этой категории пока ничего нет.' : 'Загляните позже.'}
          actionLabel={category ? 'Показать все' : undefined}
          onAction={category ? () => setCategory(null) : undefined}
        />
      ) : null}
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
  sub: { color: RenovaTheme.colors.textMuted, marginBottom: 12, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border, backgroundColor: RenovaTheme.colors.surfaceMuted },
  chipOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.accentMuted },
  chipT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.text },
  chipTOn: { color: RenovaTheme.colors.accent },
  card: { backgroundColor: RenovaTheme.colors.surface, padding: 14, borderRadius: 12, marginBottom: 10 },
  cat: { ...screenTypography.metricLabel, color: RenovaTheme.colors.primary, marginTop: 0 },
  title: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  summary: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 6 },
  meta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 8 },
});
