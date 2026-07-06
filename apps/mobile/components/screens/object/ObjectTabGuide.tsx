/** Подсказка на вкладках hub «Объект» — что читать, что делать, куда дальше */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router, usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { budgetTabHref, calendarTabHref, repairTabHref, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

export type ObjectTabId = 'profile' | 'rooms' | 'estimate' | 'plan';

type Guide = {
  read: string;
  do: string;
  next?: { tab: ObjectTabId; label: string };
};

const GUIDES: Record<ObjectTabId, Guide> = {
  profile: {
    read: 'Сводка объекта: название, адрес, тип и сроки.',
    do: 'Заполните пробелы и нажмите «Сохранить».',
    next: { tab: 'rooms', label: 'Дальше: Комнаты →' },
  },
  rooms: {
    read: 'Список комнат по этажам — площади и параметры.',
    do: 'Откройте комнату. Ход работ — в «Ремонт → Этапы».',
    next: { tab: 'estimate', label: 'Дальше: Смета →' },
  },
  estimate: {
    read: 'Работы и материалы с итоговой суммой проекта.',
    do: 'Раскройте списки по комнатам. Одобряйте доп. работы — кнопки «Бюджет» и «Материалы» ниже.',
    next: { tab: 'plan', label: 'Дальше: План →' },
  },
  plan: {
    read: 'Три слоя: планировка, дизайн, график этапов.',
    do: 'Выберите слой ниже. Сроки проекта — в «Профиль», выполнение — в «Ремонт».',
  },
};

const PLAN_LINKS = (role: OsRole) => [
  { label: '→ Ремонт', href: repairTabHref(role, 'works') },
  { label: '→ Бюджет', href: budgetTabHref(role, 'summary') },
  { label: '→ Календарь', href: calendarTabHref(role) },
] as const;

export function ObjectTabGuide({
  tab,
  role,
  onNextTab,
  compact,
}: {
  tab: ObjectTabId;
  role?: OsRole;
  onNextTab?: (tab: ObjectTabId) => void;
  /** Одна строка без блоков «Что здесь / Что делать» */
  compact?: boolean;
}) {
  const g = GUIDES[tab];
  const pathname = usePathname();
  if (compact) {
    return (
      <View style={s.compactRow}>
        <Text style={s.compactText} numberOfLines={2}>
          {g.do}
        </Text>
        {g.next ? (
          <Pressable
            style={s.compactNext}
            onPress={() => (onNextTab ? onNextTab(g.next!.tab) : router.setParams({ tab: g.next!.tab }))}
          >
            <Text style={s.nextT}>{g.next.label}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <View style={s.box}>
      <Text style={s.label}>Что здесь</Text>
      <Text style={s.read}>{g.read}</Text>
      <Text style={s.label}>Что делать</Text>
      <Text style={s.do}>{g.do}</Text>
      {g.next ? (
        <Pressable
          style={s.next}
          onPress={() => (onNextTab ? onNextTab(g.next!.tab) : router.setParams({ tab: g.next!.tab }))}
        >
          <Text style={s.nextT}>{g.next.label}</Text>
        </Pressable>
      ) : null}
      {tab === 'plan' && role && !compact ? (
        <View style={s.linksRow}>
          {PLAN_LINKS(role).map((link) => (
            <Pressable key={link.label} style={s.linkBtn} onPress={() => pushOsNav(link.href, pathname)}>
              <Text style={s.linkT}>{link.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
    paddingVertical: 4,
  },
  compactText: { flex: 1, fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  compactNext: { flexShrink: 0 },
  box: {
    ...card,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: RenovaTheme.colors.primary,
    backgroundColor: '#F8FAFC',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 6,
    marginBottom: 2,
  },
  read: { fontSize: 13, color: RenovaTheme.colors.text, lineHeight: 18 },
  do: { fontSize: 13, color: RenovaTheme.colors.text, lineHeight: 18, marginBottom: 4 },
  next: { marginTop: 8, alignSelf: 'flex-start' },
  nextT: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary },
  linksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  linkBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.primary,
    backgroundColor: RenovaTheme.colors.surface,
  },
  linkT: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary },
});
