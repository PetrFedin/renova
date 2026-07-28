/** Подсказка на вкладках hub «Объект» — dismissible, по умолчанию compact */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { budgetTabHref, repairTabHref, type OsRole } from '@/constants/osSections';
import { formMetaText } from '@/constants/formTypography';
import { objectProfileHint } from '@/lib/domain/roleCapabilities';
import { objectTabGuideCompact } from '@/lib/detailLevelPolicy';
import { pushOsNav } from '@/lib/pushOsNav';
import { useDetailLevel } from '@/lib/useDetailLevel';
import { reportCatch } from '@/lib/reportError';

export type ObjectTabId = 'profile' | 'rooms' | 'estimate' | 'plan';

type Guide = {
  read: string;
  do: string;
  next?: { tab: ObjectTabId; label: string };
};

const GUIDES: Record<ObjectTabId, Guide> = {
  profile: {
    read: 'О проекте: название, адрес, тип и сроки.',
    do: 'Заполните пробелы и нажмите «Сохранить».',
    next: { tab: 'rooms', label: 'Дальше: Комнаты →' },
  },
  rooms: {
    read: 'Список комнат по этажам — площади и параметры.',
    do: 'Откройте комнату. Ход работ — в «Ремонт → Этапы».',
    next: { tab: 'estimate', label: 'Дальше: Смета →' },
  },
  estimate: {
    read: 'Четыре слоя: итог, изменения, детализация, документы.',
    do: 'Согласуйте доп. работы во вкладке «Изменения». PDF и Excel — «Документы».',
    next: { tab: 'plan', label: 'Дальше: План →' },
  },
  plan: {
    read: 'Планировка и дизайн. Сроки — в «Календарь».',
    do: 'Выберите слой ниже. Замечания с фото — «Замечания на плане».',
  },
};

const PLAN_LINKS = (role: OsRole) => [
  { label: '→ Ремонт', href: repairTabHref(role, 'works') },
  { label: '→ Деньги', href: budgetTabHref(role, 'summary') },
] as const;

function dismissKey(tab: ObjectTabId) {
  return `renova_object_guide_dismissed_${tab}`;
}

export function ObjectTabGuide({
  tab,
  role,
  onNextTab,
  compact: compactProp,
}: {
  tab: ObjectTabId;
  role?: OsRole;
  onNextTab?: (tab: ObjectTabId) => void;
  /** Принудительный compact; по умолчанию — из detailLevel (brief → compact) */
  compact?: boolean;
}) {
  const g = GUIDES[tab];
  const pathname = usePathname();
  const detailLevel = useDetailLevel();
  const compact = compactProp ?? objectTabGuideCompact(detailLevel);
  const doText = tab === 'profile' && role ? objectProfileHint({ role, readOnly: false }) : g.do;
  const [dismissed, setDismissed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(dismissKey(tab))
      .then((v) => {
        if (alive) {
          setDismissed(v === '1');
          setReady(true);
        }
      })
      .catch((e) => {
        reportCatch('ObjectTabGuide.dismissLoad')(e);
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [tab]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    AsyncStorage.setItem(dismissKey(tab), '1').catch(reportCatch('ObjectTabGuide.dismissSave'));
  }, [tab]);

  if (!ready || dismissed) return null;

  if (compact) {
    return (
      <View style={s.compactRow}>
        <Text style={s.compactText} numberOfLines={2}>
          {doText}
        </Text>
        {g.next ? (
          <Pressable
            style={s.compactNext}
            onPress={() => (onNextTab ? onNextTab(g.next!.tab) : router.setParams({ tab: g.next!.tab }))}
          >
            <Text style={s.nextT}>{g.next.label}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={dismiss} accessibilityLabel="Скрыть подсказку" hitSlop={8}>
          <Text style={s.dismiss}>Скрыть</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.box}>
      <View style={s.boxHead}>
        <Text style={s.label}>Что здесь</Text>
        <Pressable onPress={dismiss} hitSlop={8}>
          <Text style={s.dismiss}>Скрыть</Text>
        </Pressable>
      </View>
      <Text style={s.read}>{g.read}</Text>
      <Text style={s.label}>Что делать</Text>
      <Text style={s.do}>{doText}</Text>
      {g.next ? (
        <Pressable
          style={s.next}
          onPress={() => (onNextTab ? onNextTab(g.next!.tab) : router.setParams({ tab: g.next!.tab }))}
        >
          <Text style={s.nextT}>{g.next.label}</Text>
        </Pressable>
      ) : null}
      {tab === 'plan' && role ? (
        <View style={s.linksRow}>
          {PLAN_LINKS(role).map((link) => (
            <Pressable key={link.label} style={s.linkBtn} onPress={() => pushOsNav(link.href, pathname, role)}>
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
    gap: 8,
    marginBottom: 12,
    paddingVertical: 4,
  },
  compactText: { flex: 1, ...formMetaText.caption },
  compactNext: { flexShrink: 0 },
  dismiss: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  box: {
    ...card,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: RenovaTheme.colors.primary,
    backgroundColor: '#F8FAFC',
  },
  boxHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: {
    ...screenTypography.metricLabel,
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
