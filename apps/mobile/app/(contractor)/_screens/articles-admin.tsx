import { useEffect, useState } from "react";
import { View, TextInput, ScrollView, StyleSheet, Alert, Text, Pressable } from "react-native";
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from "@/components/renova/PrimaryButton";
import { useRenova } from "@/lib/context/RenovaContext";
import { api } from "@/lib/api";
import { RenovaTheme } from "@/constants/Theme";

export default function ArticlesAdmin() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useRenova();
  const [list, setList] = useState<{ slug: string; title: string }[]>([]);
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [slug, setSlug] = useState("new-tip");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const reload = () => user && api.listArticlesAdmin(user.id).then(setList);
  useEffect(() => { reload(); }, [user?.id]);

  const save = async () => {
    if (!user) return;
    if (editSlug) await api.updateArticleAdmin(user.id, editSlug, { slug, title, category: "process", summary: title, body, tags: "" });
    else await api.createArticleAdmin(user.id, { slug, title, category: "process", summary: title, body, tags: "" });
    Alert.alert("Сохранено"); setEditSlug(null); reload();
  };

  return (
    <>
      <BackHeader title="Статьи" returnTo={returnTo} />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, gap: 8 }}>
        {list.map((a) => (
          <Pressable key={a.slug} style={s.row} onPress={() => { setEditSlug(a.slug); setSlug(a.slug); setTitle(a.title); }}>
            <Text style={s.rowT}>{a.title}</Text>
            <Pressable onPress={async () => { if (user) { await api.deleteArticleAdmin(user.id, a.slug); reload(); } }}><Text style={s.del}>✕</Text></Pressable>
          </Pressable>
        ))}
        <TextInput style={s.inp} placeholder="Идентификатор (латиница)" value={slug} onChangeText={setSlug} editable={!editSlug} />
        <TextInput style={s.inp} placeholder="Заголовок" value={title} onChangeText={setTitle} />
        <TextInput style={[s.inp, { minHeight: 120 }]} placeholder="Текст" multiline value={body} onChangeText={setBody} />
        <PrimaryButton title={editSlug ? "Обновить" : "Опубликовать"} onPress={save} />
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
