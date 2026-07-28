/** Общие pickers комнаты / этапа / категории — scan-receipt и ManualExpenseForm */
import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, filterChipStyles } from '@/constants/screenTypography';
import { RoomPickerChips } from '@/components/renova/RoomPickerChips';
import { StagePickerChips } from '@/components/renova/StagePickerChips';
import { EXPENSE_CATEGORIES, type ExpenseCategoryId } from '@/constants/expenseCategories';
import { resolveStageForRoom } from '@/lib/stageResolve';
import type { ProjectDetail, Room, Stage } from '@/lib/api';

type ExpensePickerProject = Pick<ProjectDetail, 'rooms' | 'stages'> | { rooms?: Room[]; stages?: Stage[] };

type Props = {
  project: ExpensePickerProject;
  roomId: string | null;
  stageId: string | null;
  category: ExpenseCategoryId;
  onRoomChange: (id: string | null) => void;
  onStageChange: (id: string | null) => void;
  onCategoryChange: (id: ExpenseCategoryId) => void;
  disabled?: boolean;
  showCategory?: boolean;
};

export function ExpenseContextPickers({
  project,
  roomId,
  stageId,
  category,
  onRoomChange,
  onStageChange,
  onCategoryChange,
  disabled,
  showCategory = true,
}: Props) {
  const prevRoom = useRef<string | null>(roomId);

  useEffect(() => {
    if (roomId === prevRoom.current) return;
    prevRoom.current = roomId;
    onStageChange(roomId ? resolveStageForRoom(project.stages || [], roomId, null) : null);
  }, [roomId, project.stages, onStageChange]);

  return (
    <>
      {project.rooms?.length ? (
        <RoomPickerChips rooms={project.rooms} value={roomId} onChange={disabled ? () => {} : onRoomChange} />
      ) : null}
      {project.stages?.length ? (
        <StagePickerChips stages={project.stages} value={stageId} onChange={disabled ? () => {} : onStageChange} />
      ) : null}
      {showCategory ? (
        <>
          <Text style={s.catLabel}>Категория расхода</Text>
          <View style={filterChipStyles.row}>
            {EXPENSE_CATEGORIES.map((item) => {
              const selected = category === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Категория расхода: ${item.label}`}
                  accessibilityState={{ selected, disabled: Boolean(disabled) }}
                  style={[filterChipStyles.chip, s.chipTouch, selected && filterChipStyles.chipOn]}
                  disabled={disabled}
                  onPress={() => onCategoryChange(item.id)}
                >
                  <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  catLabel: { ...screenTypography.section, marginTop: 6, marginBottom: 4 },
  chipTouch: { minHeight: RenovaTheme.minTouch, justifyContent: 'center' },
});
