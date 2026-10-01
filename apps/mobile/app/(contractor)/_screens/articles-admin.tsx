import { useEffect, useState } from "react";
import { View, TextInput, ScrollView, StyleSheet, Text, Pressable } from "react-native";
import { notifyAlert, notifyError, confirmAction } from '@/lib/notify';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from "@/components/renova/PrimaryButton";
import { useRenova } from "@/lib/context/RenovaContext";
import { api } from "@/lib/api";
import { RenovaTheme } from "@/constants/Theme";
import { validateArticleForm } from '@/lib/domain/articleListState';
import { reportError } from '@/lib/reportError';

type Loaded = { category: string; read_min: number };

export default function ArticlesAdmin() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useRenova();
  const [list, setList] = useState<{ slug: string; title: string; published?: boolean }[]>([]);
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [slug, setSlug] = useState("new-tip");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");
  // Поля, которых нет в форме, сохраняем как были — иначе правка затирала бы категорию и время чтения.
  const [kept, setKept] = useState<Loaded>({ category: "process", read_min: 3 });
  const [loadingBody, setLoadingBody] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    if (!user) return;
    api.listArticlesAdmin(user.id).then(setList).catch((e: unknown) => notifyError('Не удалось загрузить список', e));
  };
  useEffect(() => { reload(); }, [user?.id]);

  const reset = () => {
    setEditSlug(null); setSlug("new-tip"); setTitle(""); setSummary(""); setTags(""); setBody("");
    setKept({ category: "process", read_min: 3 });
  };

  const startEdit = async (s: string) => {
    if (!user) return;
    setLoadingBody(true);
    try {
      const a = await api.getArticleAdmin(user.id, s);
      setEditSlug(a.slug); setSlug(a.slug); setTitle(a.title); setSummary(a.summary);
      setTags(a.tags); setBody(a.body);
      setKept({ category: a.category, read_min: a.read_min });
    } catch (e) {
      reportError('articlesAdmin.load', e, { slug: s });
      notifyError('Не удалось открыть статью', e);
    } finally {
      setLoadingBody(false);
    }
  };

  const save = async () => {
    if (!user || saving) return;
    const problem = validateArticleForm({ slug, title, body });
    if (problem) { notifyAlert("Проверьте поля", problem); return; }
    const payload = { slug: slug.trim(), title: title.trim(), category: kept.category, summary: summary.trim() || title.trim(), body, tags: tags.trim(), read_min: kept.read_min };
    setSaving(true);
    try {
      if (editSlug) await api.updateArticleAdmin(user.id, editSlug, payload);
      else await api.createArticleAdmin(user.id, payload);
    } catch (e) {
      reportError('articlesAdmin.save', e, { slug });
      notifyError('Не удалось сохранить статью', e);
      return;
    } finally {
      setSaving(false);
    }
    notifyAlert("Сохранено");
    reset();
    reload();
  };

  const unpublish = async (a: { slug: string; title: string }) => {
    if (!user) return;
    const ok = await confirmAction({ title: 'Снять статью с публикации?', message: a.title, confirmLabel: 'Снять', destructive: true });
    if (!ok) return;
    try {
      await api.deleteArticleAdmin(user.id, a.slug);
    } catch (e) {
      notifyError('Не удалось снять статью', e);
      return;
    }
    reload();
  };

  return (
    <>
      <BackHeader title="Статьи" returnTo={returnTo} />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, gap: 8 }}>
        {list.map((a) => (
          <Pressable key={a.slug} style={s.row} onPress={() => void startEdit(a.slug)}>
            <Text style={s.rowT}>{a.title}{a.published === false ? ' (снята)' : ''}</Text>
            <Pressable onPress={() => void unpublish(a)} accessibilityRole="button" accessibilityLabel={`Снять с публикации: ${a.title}`} style={{ minWidth: RenovaTheme.minTouch, minHeight: RenovaTheme.minTouch, alignItems: 'center', justifyContent: 'center' }}><Text style={s.del}>✕</Text></Pressable>
          </Pressable>
        ))}
        {loadingBody ? <Text style={s.rowT}>Загрузка статьи…</Text> : null}
        <TextInput style={s.inp} placeholder="Идентификатор (латиница)" value={slug} onChangeText={setSlug} editable={!editSlug} />
        <TextInput style={s.inp} placeholder="Заголовок" value={title} onChangeText={setTitle} />
        <TextInput style={s.inp} placeholder="Краткое описание" value={summary} onChangeText={setSummary} />
        <TextInput style={s.inp} placeholder="Теги через запятую" value={tags} onChangeText={setTags} />
        <TextInput style={[s.inp, { minHeight: 120 }]} placeholder="Текст" multiline value={body} onChangeText={setBody} />
        <PrimaryButton title={editSlug ? "Обновить" : "Опубликовать"} variant="accent" loading={saving} disabled={loadingBody} onPress={save} />
        {editSlug ? <PrimaryButton title="Отменить правку" variant="outline" onPress={reset} /> : null}
      </ScrollView>
    </>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  inp: { backgroundColor: "#fff", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#eee" },
  row: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#fff", padding: 10, borderRadius: 8 },
  rowT: { fontWeight: "600", flex: 1 },
  del: { color: "#c00", paddingHorizontal: 8 },
});
