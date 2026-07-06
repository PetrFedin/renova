/** «Сделать сейчас» v2 — hero stack + full-width CTA */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { homeLayout, homeRowStyles, homeTypography } from '@/constants/homeTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { useChatUnread, useInboxWsListener } from '@/lib/useChatUnread';
import { buildInboxItems, inboxLinkItems, filterInboxForHero, type InboxItem } from '@/lib/domain/buildInboxItems';
import { navigateApproval } from '@/lib/navigation';
import { useOsNavFromHere } from '@/lib/navigation';
import type { ProjectOsSnapshot, OsNextAction } from '@/lib/domain/osTypes';
import type { OsInsight } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { isClosingPhaseSecondary, resolveProjectPhase } from '@/lib/domain/resolveProjectPhase';

type Props = {
  role: OsRole;
  snap: ProjectOsSnapshot;
  insights: OsInsight[];
  showHero: boolean;
  showInbox: boolean;
  showInsights: boolean;
};

function duplicatesHero(item: InboxItem, hero: OsNextAction): boolean {
  return !filterInboxForHero([item], hero.kind).length;
}

export function HomeActionHero({ role, snap, insights, showHero, showInbox, showInsights }: Props) {
  const { user, activeProject, readOnly } = useRenova();
  const { pushNav, returnTo } = useOsNavFromHere(role);
  const { count: chatUnread } = useChatUnread(user?.id);
  const [items, setItems] = useState<InboxItem[]>([]);

  const reload = useCallback(async () => {
    if (!user || !activeProject) {
      setItems([]);
      return;
    }
    const list = await buildInboxItems({
      userId: user.id,
      projectId: activeProject.id,
      role,
      chatUnread,
      project: activeProject,
    });
    setItems(list);
  }, [user?.id, activeProject, role, chatUnread]);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));
  useInboxWsListener(useCallback(() => { reload().catch(() => {}); }, [reload]));

  const hero = snap.nextAction;
  const phase = resolveProjectPhase(snap);
  const inboxForLink = inboxLinkItems(items, hero.kind);
  const secondary = (showInbox ? items : [])
    .filter((it) => !duplicatesHero(it, hero))
    .filter((it) => phase !== 'closing' || isClosingPhaseSecondary(it.kind))
    .slice(0, 2);
  const copilotFallback = showInsights && secondary.length < 2 && insights[0] && hero.kind !== 'payment'
    ? insights.find((i) => i.kind !== 'payment') || insights[0]
    : null;

  const hasContent = showHero || secondary.length > 0 || copilotFallback || inboxForLink.length > 0;
  if (!hasContent) return null;

  return (
    <View style={s.wrap}>
      <View style={s.zoneHead}>
        <Text style={homeTypography.zoneLabel}>Сделать сейчас</Text>
        {inboxForLink.length > 0 ? (
          <Pressable
            onPress={() => router.push({ pathname: '/inbox', params: { returnTo, heroKind: hero.kind } } as any)}
            hitSlop={8}
          >
            <Text style={homeTypography.link}>Все задачи ({inboxForLink.length}) →</Text>
          </Pressable>
        ) : null}
      </View>

      {showHero && (
        <View style={s.hero}>
          <Text style={homeTypography.heroTitle} numberOfLines={2}>{hero.title}</Text>
          {hero.subtitle ? (
            <Text style={[homeTypography.heroSub, s.heroSubSpaced]} numberOfLines={2}>{hero.subtitle}</Text>
          ) : null}
          {readOnly ? (
            <Pressable style={s.viewOnlyHero} onPress={() => pushNav(hero.href)} accessibilityRole="button">
              <Text style={homeTypography.actionRow}>Посмотреть · {hero.button}</Text>
              <Text style={homeTypography.link}>→</Text>
            </Pressable>
          ) : (
            <PrimaryButton
              title={hero.button}
              fullWidth
              onPress={() => pushNav(hero.href)}
            />
          )}
        </View>
      )}

      {secondary.map((it) => (
        <Pressable
          key={it.id}
          style={s.secondary}
          onPress={() => {
            if (it.kind === 'approval') navigateApproval(it.approval, role, returnTo);
            else pushNav(it.href);
          }}
        >
          <Text style={s.bullet}>•</Text>
          <Text style={[homeTypography.actionRow, s.secondaryText]} numberOfLines={1}>
            {it.title}{it.sub ? ` · ${it.sub}` : ''}
          </Text>
          <Text style={homeTypography.link}>→</Text>
        </Pressable>
      ))}

      {copilotFallback && (
        <Pressable style={s.secondary} onPress={() => pushNav(copilotFallback.href)}>
          <Text style={s.bullet}>•</Text>
          <Text style={[homeTypography.actionRow, s.secondaryText]} numberOfLines={2}>{copilotFallback.title}</Text>
          <Text style={homeTypography.link}>→</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: homeLayout.sectionGap },
  zoneHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: homeLayout.innerGap,
  },
  hero: {
    ...card,
    marginBottom: homeLayout.innerGap,
    padding: homeLayout.heroCardPadding,
    borderRadius: homeLayout.heroCardRadius,
    gap: 4,
  },
  heroSubSpaced: { marginBottom: 8 },
  viewOnlyHero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    gap: homeLayout.innerGap,
  },
  secondary: {
    ...homeRowStyles.linkRow,
    justifyContent: 'flex-start',
  },
  bullet: { color: RenovaTheme.colors.accent, fontWeight: '800', width: 12 },
  secondaryText: { flex: 1 },
});
