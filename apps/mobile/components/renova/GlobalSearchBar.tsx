import { useEffect, useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { searchProject } from '@/lib/globalSearch';
import { pushSearch, getSearchHistory } from '@/lib/searchHistory';
import { getCachedSearch } from '@/lib/offlineSearchCache';
import { searchChats } from '@/lib/chatSearchCache';
import { api, ProjectDetail } from '@/lib/api';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';

function openSearchHit(
  h: { href: string; type?: string; msgId?: string },
  returnTo?: string,
  role: OsRole = 'customer',
) {
  // W110: чат — dynamic segment + highlight; остальное через pushOsNav SoT
  if (h.type === 'chat' || h.href.startsWith('/chat/')) {
    const threadId = h.href.replace('/chat/', '').split('?')[0].split('/')[0];
    router.push({
      pathname: '/chat/[threadId]',
      params: { threadId, ...(h.msgId ? { highlightId: h.msgId } : {}), ...(returnTo ? { returnTo } : {}) },
    } as any);
    return;
  }
  pushOsNav(h.href, returnTo, role);
}

export function GlobalSearchBar({
  project,
  chatTitles,
  userId,
  suggestions = [],
  returnTo,
  role = 'customer',
}: {
  project: ProjectDetail;
  chatTitles?: Record<string, string>;
  userId?: string;
  suggestions?: string[];
  /** Текущий экран — для полоски «Назад» на результатах поиска */
  returnTo?: string;
  role?: OsRole;
}) {
  const [q, setQ] = useState('');
  const [hist, setHist] = useState<string[]>([]);
  const [offline, setOffline] = useState<any>(null);
  const [chatHits, setChatHits] = useState<any[]>([]);
  useEffect(() => { getSearchHistory().then(setHist); getCachedSearch().then(setOffline); }, []);
  useEffect(() => {
    if (!q.trim()) { setChatHits([]); return; }
    searchChats(q).then(setChatHits);
    if (userId) api.searchChatMessages(userId, project.id, q).then(ms => setChatHits(h => [...h, ...ms.map(m => ({ id: m.thread_id, title: 'Чат', text: m.text, href: `/chat/${m.thread_id}`, msgId: m.id }))])).catch(() => {});
  }, [q, userId, project.id]);
  const hits = [...searchProject(project, q, chatTitles), ...chatHits.map(c => ({ id: c.id, type: 'chat' as const, title: c.title, sub: c.text, href: `/chat/${c.id}`, msgId: c.msgId }))];
  const onSearch = (s: string) => { setQ(s); pushSearch(s).then(() => getSearchHistory().then(setHist)); };
  const offlineHits = offline && q.trim() ? [
    ...offline.stages.filter((s: any) => s.name.toLowerCase().includes(q.toLowerCase())).map((s: any) => ({ href: `/stage/${s.id}`, title: s.name, sub: 'офлайн' })),
    ...offline.rooms.filter((r: any) => r.name.toLowerCase().includes(q.toLowerCase())).map((r: any) => ({ href: `/room/${r.id}`, title: r.name, sub: 'офлайн' })),
  ] : [];
  const all = hits.length ? hits : offlineHits;
  const quick = suggestions.filter((x) => x && x !== q);
  const placeholder = quick.length ? `Поиск: ${quick.slice(0, 3).join(', ')}…` : 'Поиск по проекту…';
  return (
    <View style={s.wrap}>
      <TextInput style={s.input} placeholder={placeholder} value={q} onChangeText={onSearch} />
      {!!quick.length && !q && (
        <View style={s.hist}>
          <Text style={s.histLabel}>По проекту сейчас</Text>
          {quick.map((h) => (
            <Pressable key={h} onPress={() => onSearch(h)}>
              <Text style={s.histT}>{h}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!!hist.length && !q && (
        <View style={s.hist}>
          {hist.map((h) => <Pressable key={h} onPress={() => onSearch(h)}><Text style={s.histT}>{h}</Text></Pressable>)}
        </View>
      )}
      {all.map((h: any) => (
        <Pressable key={h.id || h.href} style={s.hit} onPress={() => openSearchHit(h, returnTo, role)}>
          <Text style={s.title}>{h.title}</Text><Text style={s.sub}>{h.sub}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { marginBottom: 12 }, input: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  hist: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' },
  histLabel: { width: '100%', fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginBottom: 2 },
  histT: { fontSize: 11, color: RenovaTheme.colors.primary, backgroundColor: '#eff6ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  hit: { backgroundColor: RenovaTheme.colors.surface, padding: 10, borderRadius: 8, marginTop: 6 },
  title: { fontWeight: '700' }, sub: { fontSize: 12, color: RenovaTheme.colors.textMuted },
});
