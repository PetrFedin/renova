/** Информационный баннер — info / warning / danger */
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { dangerSurface, infoSurface, warningSurface } from '@/constants/uiTokens';
import { typography } from '@/constants/typography';
import type { StatusTone } from '@/components/ui/StatusPill';

const cfg: Record<Exclude<StatusTone, 'neutral' | 'success'>, { surface: object; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  info: { surface: infoSurface, icon: 'information-circle-outline', color: RenovaTheme.colors.infoText },
  warning: { surface: warningSurface, icon: 'alert-circle-outline', color: RenovaTheme.colors.warningText },
  danger: { surface: dangerSurface, icon: 'warning-outline', color: RenovaTheme.colors.dangerText },
};

export function InfoBanner({ tone, title, message }: { tone: 'info' | 'warning' | 'danger'; title?: string; message: string }) {
  const c = cfg[tone];
  return (
    <View style={[s.wrap, c.surface]}>
      <Ionicons name={c.icon} size={20} color={c.color} style={s.icon} />
      <View style={s.body}>
        {title ? <Text style={[typography.bodySemibold, { color: c.color }]}>{title}</Text> : null}
        <Text style={typography.bodySmall}>{message}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: RenovaTheme.spacing.md,
    marginBottom: RenovaTheme.spacing.sm,
    gap: RenovaTheme.spacing.sm,
  },
  icon: { marginTop: 1 },
  body: { flex: 1, minWidth: 0, gap: 2 },
});
