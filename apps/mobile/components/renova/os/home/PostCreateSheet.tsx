/** После создания объекта — «Что дальше?» вместо мгновенного jump на tabs */
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.head}>Объект создан</Text>
          <Text style={s.sub}>«{projectName}» готов. Что дальше?</Text>
          {STEPS.map((step) => (
            <Pressable key={step.id} style={s.row} onPress={() => onNavigate(step.href, step.id)}>
              <Ionicons name={step.icon} size={22} color={RenovaTheme.colors.primary} />
              <View style={s.body}>
                <Text style={s.label}>{step.label}</Text>
                <Text style={s.hint}>{step.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={RenovaTheme.colors.textSubtle} />
            </Pressable>
          ))}
          <Pressable style={s.homeBtn} onPress={onHome}>
            <Text style={s.homeT}>На главную</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: RenovaTheme.radius.xl,
    borderTopRightRadius: RenovaTheme.radius.xl,
    padding: RenovaTheme.spacing.lg,
    paddingBottom: 32,
    gap: 4,
  },
  head: { fontSize: RenovaTheme.fontSize.h1, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  sub: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
  },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.text },
  hint: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  homeBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 12 },
  homeT: { fontSize: RenovaTheme.fontSize.body, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.accent },
});
