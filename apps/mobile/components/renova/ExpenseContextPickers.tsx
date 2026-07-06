/** Общие pickers комнаты / этапа / категории — scan-receipt и ManualExpenseForm */
import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
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
      {showCategory && (
        <>
          <Text style={s.catLabel}>Категория расхода</Text>
          <View style={s.catRow}>
            {EXPENSE_CATEGORIES.map((c) => (
              <Pressable
                key={c.id}
                style={[s.catChip, category === c.id && s.catOn]}
                onPress={() => !disabled && onCategoryChange(c.id)}
              >
                <Text style={[s.catT, category === c.id && s.catTOn]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </>
  );
}

const s = StyleSheet.create({
  catLabel: { fontSize: 12, fontWeight: '600', marginTop: 4, color: RenovaTheme.colors.textMuted },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  catChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f3f4f6' },
  catOn: { backgroundColor: RenovaTheme.colors.primary },
  catT: { fontSize: 11, fontWeight: '600' },
  catTOn: { color: '#fff' },
});
