/** Компактная панель действий календаря — иконки в строку, подсказка при наведении */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { readTextFileWeb } from '@/lib/mediaUpload';

type Action = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

function IconTip({ icon, label, onPress, disabled }: Omit<Action, 'id'>) {
  const [hover, setHover] = useState(false);
  return (
    <View style={s.tipWrap}>
      <Pressable
        style={[s.btn, disabled && s.btnDisabled]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        // @ts-expect-error web title fallback
        title={Platform.OS === 'web' ? label : undefined}
      >
        <Ionicons name={icon} size={20} color={disabled ? RenovaTheme.colors.textSubtle : RenovaTheme.colors.text} />
      </Pressable>
      {hover && Platform.OS === 'web' && (
        <View style={s.tooltip}>
          <Text style={s.tooltipT}>{label}</Text>
        </View>
      )}
    </View>
  );
}

export function ScheduleIconToolbar({
  readOnly,
  canManageWorks = true,
  canAddTask = false,
  userId,
  projectId,
  onCreateWork,
  onStages,
  onMaterials,
  onImported,
}: {
  readOnly?: boolean;
  /** Назначение работ и импорт .ics — только исполнитель */
  canManageWorks?: boolean;
  /** Добавить задачу в план (заказчик и исполнитель) */
  canAddTask?: boolean;
  userId: string;
  projectId: string;
  onCreateWork: () => void;
  onStages: () => void;
  onMaterials: () => void;
  onImported?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const importIcal = async () => {
    if (Platform.OS !== 'web') {
      Alert.alert('Календарь', 'Импорт .ics доступен в веб-версии');
      return;
    }
    const text = await readTextFileWeb('.ics,text/calendar');
    if (!text) return;
    if (!text.includes('BEGIN:VCALENDAR')) {
      Alert.alert('Календарь', 'Некорректный формат файла');
      return;
    }
    setBusy(true);
    try {
      const r = await api.importIcal(userId, projectId, text);
      Alert.alert('Календарь', `Обновлено этапов: ${(r as { updated_stages?: number }).updated_stages ?? '—'}`);
      onImported?.();
    } catch {
      Alert.alert('Календарь', 'Не удалось импортировать');
    } finally {
      setBusy(false);
    }
  };

  const actions: Action[] = [
    ...(canManageWorks ? [
      { id: 'work', icon: 'add-circle-outline' as const, label: 'Назначить работу', onPress: onCreateWork, disabled: readOnly },
      { id: 'ical', icon: 'cloud-upload-outline' as const, label: 'Импорт календаря', onPress: importIcal, disabled: readOnly || busy },
    ] : []),
    ...(canAddTask && !canManageWorks ? [
      { id: 'task', icon: 'add-circle-outline' as const, label: 'Добавить задачу', onPress: onCreateWork, disabled: readOnly },
    ] : []),
    { id: 'stages', icon: 'layers-outline', label: 'Этапы ремонта', onPress: onStages },
    { id: 'materials', icon: 'cube-outline', label: 'Материалы', onPress: onMaterials },
  ];

  return (
    <View style={s.row}>
      {actions.map((a) => (
        <IconTip key={a.id} icon={a.icon} label={a.label} onPress={a.onPress} disabled={a.disabled} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  tipWrap: { position: 'relative' },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  tooltip: {
    position: 'absolute',
    bottom: 44,
    left: '50%',
    transform: [{ translateX: -50 }],
    backgroundColor: '#0f172a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    zIndex: 20,
    minWidth: 120,
  },
  tooltipT: { color: RenovaTheme.colors.surface, fontSize: 11, textAlign: 'center' },
});
