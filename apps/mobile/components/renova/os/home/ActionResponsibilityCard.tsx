import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RenovaTheme } from '@/constants/Theme';
import type { ResponsibilityItem, ResponsibilityQueue } from '@/lib/api';

const PERSONA_LABEL: Record<string, string> = {
  owner: 'Владелец',
  lead: 'Ведущий исполнитель',
  foreman: 'Прораб',
  member: 'Исполнитель',
  participant: 'Участник работ',
  supervisor: 'Технадзор',
  guest: 'Наблюдатель',
};

const ACTION_LABEL: Record<string, string> = {
  resolve_issue: 'Устранить замечание',
  verify_remediation: 'Проверить исправление',
  decide_work_acceptance: 'Принять решение по работе',
  resubmit_stage: 'Повторно сдать этап на приёмку',
};

function evidenceLabel(item: ResponsibilityItem): string {
  if (item.evidence.required.length === 0) {
    return item.evidence.present.length > 0
      ? 'Доказательства: ' + item.evidence.present.length
      : 'Обязательное доказательство сервером пока не требуется';
  }
  return 'Нужно доказать: ' + item.evidence.required.join(', ');
}

export function ActionResponsibilityCard({
  queue,
  userId,
  onOpen,
}: {
  queue: ResponsibilityQueue | null;
  userId: string;
  onOpen: () => void;
}) {
  const item = queue?.items?.[0];
  if (!item) return null;

  const mine = Boolean(item.responsible_user_id && item.responsible_user_id === userId);
  const actor = mine
    ? 'Ваше действие'
    : 'Сейчас действует: ' + (PERSONA_LABEL[item.responsible_persona] || item.responsible_persona);
  const next = item.next
    ? 'Дальше: ' + (PERSONA_LABEL[item.next.persona] || item.next.persona)
    : 'Это последний шаг в текущей цепочке';

  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={s.card}>
      <Text style={s.eyebrow}>{actor}</Text>
      <Text style={s.title}>{ACTION_LABEL[item.action] || item.action}</Text>
      <Text style={s.resource}>{item.resource_title}</Text>
      <View style={s.meta}>
        <Text style={s.metaText}>{evidenceLabel(item)}</Text>
        <Text style={s.metaText}>{next}</Text>
      </View>
      <Text style={s.link}>Открыть действие →</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    marginTop: 10,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.infoBorder,
    borderRadius: RenovaTheme.radius.lg,
    backgroundColor: RenovaTheme.colors.infoBg,
  },
  eyebrow: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.infoText,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  title: {
    marginTop: 4,
    fontSize: RenovaTheme.fontSize.h3,
    color: RenovaTheme.colors.text,
    fontWeight: RenovaTheme.fontWeight.bold,
  },
  resource: {
    marginTop: 4,
    fontSize: RenovaTheme.fontSize.bodySmall,
    color: RenovaTheme.colors.text,
  },
  meta: { marginTop: 8, gap: 3 },
  metaText: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
  },
  link: {
    marginTop: 10,
    fontSize: RenovaTheme.fontSize.bodySmall,
    color: RenovaTheme.colors.primary,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
});
