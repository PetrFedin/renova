/**
 * Единый баннер состояния данных — заменяет ApiStatusBanner + StaleCacheBanner.
 *
 * Раньше оба рендерились одновременно в шапке (OsRoleTabsNavigator) и могли
 * накладываться друг на друга ещё и с локальным предупреждением экрана
 * («Главная обновлена частично»): пользователь видел 2-3 баннера подряд про,
 * по сути, одну и ту же проблему. Здесь — один приоритет, одно сообщение:
 *
 *   нет связи с сервером  >  нет данных проекта  >  показан устаревший кэш  >  всё ок
 *
 * Более серьёзное состояние уже подразумевает менее серьёзное, поэтому оно
 * не показывается отдельной плашкой — но ничего не скрывается: подробности
 * остаются доступны через «Подробнее», а более узкие статус-баннеры на
 * конкретных экранах (например OsHomeScreen) сверяются с этим же хуком
 * устаревания кэша, чтобы не дублировать сообщение.
 */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { useStaleCacheStatus } from '@/lib/useStaleCacheStatus';

type Props = {
  /** Показать даже если API доступен, но нет проектов */
  showEmpty?: boolean;
};

const isDemoEnv = process.env.EXPO_PUBLIC_DEMO === '1' || __DEV__;

type Level = 'danger' | 'warning' | 'subtle';

export function DataStatusBanner({ showEmpty }: Props) {
  const { apiReachable, projects, recoverSession, loading } = useRenova();
  const { stalePaths, isStale, refresh: refreshStale } = useStaleCacheStatus();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (loading) return null;

  const isEmpty = Boolean(showEmpty) && apiReachable && projects.length === 0;

  // Приоритет: нет связи > нет данных проекта > устаревший кэш > ничего.
  // Каждое следующее состояние уже покрыто предыдущим, поэтому рендерим
  // максимум одну плашку.
  let level: Level | null = null;
  let title = '';
  let sub = '';
  let action: { label: string; onPress: () => Promise<void> | void } | null = null;

  if (!apiReachable) {
    level = 'danger';
    title = 'Нет связи с сервером';
    sub = 'Проверьте интернет и нажмите «Повторить».';
    if (isStale) sub += ' Показаны последние сохранённые данные — они могут быть устаревшими.';
    action = { label: 'Повторить', onPress: recoverSession };
  } else if (isEmpty) {
    level = 'subtle';
    title = 'Нет данных проекта';
    sub = isDemoEnv ? 'Нажмите «Загрузить демо» для восстановления данных.' : 'Создайте объект или войдите снова.';
    if (isDemoEnv || !apiReachable) action = { label: 'Демо', onPress: recoverSession };
  } else if (isStale) {
    level = 'warning';
    title = 'Данные могут быть устаревшими';
    sub = `Сервер временно недоступен или ограничил запросы${
      stalePaths[0] ? ` (${stalePaths[0].replace(/^\/api\/v1/, '')})` : ''
    }. Показан последний успешный ответ.`;
    action = { label: 'OK', onPress: refreshStale };
  }

  if (!level) return null;

  return (
    <View style={[s.box, boxByLevel[level]]} accessibilityRole="alert">
      <Ionicons name={iconByLevel[level]} size={16} color={colorByLevel[level]} style={s.icon} />
      <Pressable style={s.textCol} onPress={() => setExpanded((v) => !v)} hitSlop={4}>
        <View style={s.titleRow}>
          <Text style={[s.title, { color: colorByLevel[level] }]} numberOfLines={expanded ? undefined : 1}>
            {title}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={RenovaTheme.colors.textSubtle}
          />
        </View>
        {expanded ? <Text style={s.sub}>{sub}</Text> : null}
      </Pressable>
      {busy ? (
        <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
      ) : action ? (
        <Pressable
          style={s.btn}
          onPress={async () => {
            setBusy(true);
            try {
              await action!.onPress();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Text style={s.btnT}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const boxByLevel: Record<Level, object> = {
  danger: { backgroundColor: RenovaTheme.colors.dangerBg, borderLeftColor: RenovaTheme.colors.dangerBorder },
  warning: { backgroundColor: RenovaTheme.colors.warningBg, borderLeftColor: RenovaTheme.colors.warningBorder },
  subtle: { backgroundColor: RenovaTheme.colors.borderLight, borderLeftColor: RenovaTheme.colors.border },
};

const colorByLevel: Record<Level, string> = {
  danger: RenovaTheme.colors.dangerText,
  warning: RenovaTheme.colors.warningText,
  subtle: RenovaTheme.colors.textMuted,
};

const iconByLevel: Record<Level, keyof typeof Ionicons.glyphMap> = {
  danger: 'cloud-offline-outline',
  warning: 'time-outline',
  subtle: 'information-circle-outline',
};

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 2,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderLeftWidth: 3,
  },
  icon: { flexShrink: 0 },
  textCol: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { fontWeight: '600', fontSize: 12, flexShrink: 1 },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  btn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: RenovaTheme.colors.surface,
  },
  btnT: { fontWeight: '700', fontSize: 11, color: RenovaTheme.colors.primary },
});
