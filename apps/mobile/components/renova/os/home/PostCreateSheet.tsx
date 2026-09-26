/** После создания объекта — «Что дальше?» вместо мгновенного jump на tabs */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface } from '@/components/renova/SheetSurface';
import { objectTabHref, repairTabHref, tabsHref, customerProfileTabHref } from '@/constants/osSections';

type Step = {
  id: string;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
};

const STEPS: Step[] = [
  {
    id: 'estimate',
    label: 'Проверить смету',
    sub: 'Строки, резерв и план',
    icon: 'document-text-outline',
    href: objectTabHref('customer', 'estimate'),
  },
  {
    id: 'contractor',
    label: 'Подключить исполнителя',
    sub: 'Телефон или ссылка-приглашение',
    icon: 'person-add-outline',
    href: customerProfileTabHref('customer', 'contractor'),
  },
  {
    id: 'plan',
    label: 'План и документы',
    sub: 'Договорённости и график',
    icon: 'calendar-outline',
    href: objectTabHref('customer', 'plan'),
  },
  {
    id: 'budget',
    label: 'Контроль бюджета',
    sub: 'Лимит и первые расходы',
    icon: 'wallet-outline',
    href: tabsHref('customer', 'budget', 'summary'),
  },
  {
    id: 'repair',
    label: 'Начать ремонт',
    sub: 'Этапы и приёмка работ',
    icon: 'hammer-outline',
    href: repairTabHref('customer', 'works'),
  },
];

type Props = {
  visible: boolean;
  projectName: string;
  onNavigate: (href: string, stepId?: string) => void;
  onHome: () => void;
  onClose: () => void;
};

export function PostCreateSheet({ visible, projectName, onNavigate, onHome, onClose }: Props) {
  return (
    <SheetSurface
      visible={visible}
      onClose={onClose}
      title="Объект создан"
      subtitle={`«${projectName}» готов. Что дальше?`}
      accessibilityLabel="Следующий шаг после создания объекта"
      footer={<PrimaryButton title="На главную" variant="ghost" onPress={onHome} />}
    >
      <View style={s.steps}>
        {STEPS.map((step) => (
          <Pressable
            key={step.id}
            style={({ pressed }: PressableStateCallbackType) => [s.row, pressed && s.rowPressed]}
            onPress={() => onNavigate(step.href, step.id)}
            accessibilityRole="button"
            accessibilityLabel={step.label}
            accessibilityHint={step.sub}
          >
            <Ionicons name={step.icon} size={22} color={RenovaTheme.colors.primary} />
            <View style={s.body}>
              <Text style={s.label}>{step.label}</Text>
              <Text style={s.hint}>{step.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={RenovaTheme.colors.textSubtle} />
          </Pressable>
        ))}
      </View>
    </SheetSurface>
  );
}

const s = StyleSheet.create({
  steps: { gap: RenovaTheme.spacing.xs },
  row: {
    ...listRowStyles.row,
    minHeight: RenovaTheme.minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: RenovaTheme.spacing.md,
    paddingVertical: RenovaTheme.spacing.md,
  },
  rowPressed: { opacity: 0.72 },
  body: { flex: 1, minWidth: 0 },
  label: { ...screenTypography.listTitle },
  hint: { ...screenTypography.listMeta },
});
