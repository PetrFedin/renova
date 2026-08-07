/** Компактная панель действий календаря — иконки в строку, подсказка при наведении */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { readIcalFile } from '@/lib/mediaUpload';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { alertIcalExported, alertIcalImported, ICS_SYNC_HONESTY } from '@/lib/calendarIcsNav';
import { reportError } from '@/lib/reportError';
import type { OsRole } from '@/constants/osSections';

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
  const { user, activeProject } = useRenova();
  const [busy, setBusy] = useState(false);
  const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;

  const importIcal = async () => {
    const text = await readIcalFile();
    if (!text) return;
    if (!text.includes('BEGIN:VCALENDAR')) {
      Alert.alert('Календарь', 'Некорректный формат файла');
      return;
    }
    setBusy(true);
    try {
      const result = await api.importIcal(userId, projectId, text);

      // Import is already committed at this point. Follow-up refresh must never
      // turn a successful mutation into a false "import failed" result.
      if (user?.id === userId && activeProject?.id === projectId) {
        try {
          await syncProjectSideEffects({ user, project: activeProject });
        } catch (sideEffectError) {
          reportError('schedule.iconToolbar.importIcal.sideEffects', sideEffectError, { projectId });
        }
      } else {
        reportError(
          'schedule.iconToolbar.importIcal.contextMismatch',
          new Error('Committed calendar import has no matching active Renova context'),
          { projectId, userId },
        );
      }

      alertIcalImported(result.updated_stages, role, onImported);
    } catch (error) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued('Импорт календаря');
        onImported?.();
        return;
      }
      reportError('schedule.iconToolbar.importIcal', error, { projectId });
      Alert.alert('Календарь', 'Не удалось импортировать');
    } finally {
      setBusy(false);
    }
  };

  /** W124: экспорт .ics → Share sheet / download + honesty */
  const exportIcal = async () => {
    setBusy(true);
    try {
      await api.exportIcal(userId, projectId);
      alertIcalExported(role);
    } catch (error) {
      reportError('schedule.iconToolbar.exportIcal', error, { projectId });
      Alert.alert('Календарь', 'Не удалось экспортировать .ics');
    } finally {
      setBusy(false);
    }
  };

  const actions: Action[] = [
    ...(canManageWorks ? [
      { id: 'work', icon: 'add-circle-outline' as const, label: 'Назначить работу', onPress: onCreateWork, disabled: readOnly },
      { id: 'ical-in', icon: 'cloud-upload-outline' as const, label: 'Импорт .ics', onPress: importIcal, disabled: readOnly || busy },
    ] : []),
    { id: 'ical-out', icon: 'cloud-download-outline' as const, label: 'Экспорт .ics', onPress: exportIcal, disabled: busy },
    ...(canAddTask && !canManageWorks ? [
      { id: 'task', icon: 'add-circle-outline' as const, label: 'Добавить задачу', onPress: onCreateWork, disabled: readOnly },
    ] : []),
    { id: 'stages', icon: 'layers-outline', label: 'Этапы ремонта', onPress: onStages },
    { id: 'materials', icon: 'cube-outline', label: 'Материалы', onPress: onMaterials },
  ];

  return (
    <View>
      <View style={s.row}>
        {actions.map((action) => (
          <IconTip
            key={action.id}
            icon={action.icon}
            label={action.label}
            onPress={action.onPress}
            disabled={action.disabled}
          />
        ))}
      </View>
      <Text style={s.honesty} accessibilityHint="ics-honesty">
        {ICS_SYNC_HONESTY}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  honesty: {
    fontSize: 11,
    lineHeight: 15,
    color: RenovaTheme.colors.textSubtle,
    marginBottom: 12,
  },
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
