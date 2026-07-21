/** Чеки без этапа — массовая привязка к одному этапу (без перегруза UI) */
import { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { StagePickerChips } from '@/components/renova/StagePickerChips';
import { api, type ProjectDetail, type ReceiptItem } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { alertReceiptsBulkLinked } from '@/lib/receiptNav';
import type { OsRole } from '@/constants/osSections';

type Props = {
  userId: string;
  project: ProjectDetail;
  receipts: ReceiptItem[];
  readOnly?: boolean;
  onDone: () => void;
};

export function ReceiptBulkLinkPanel({ userId, project, receipts, readOnly, onDone }: Props) {
  const { user, activeProject } = useRenova();
  const unlinked = receipts.filter((r) => !r.stage_id);
  const [stageId, setStageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!unlinked.length || readOnly) return null;

  async function linkAll() {
    if (!stageId) {
      Alert.alert('Этап', 'Выберите этап для привязки');
      return;
    }
    setBusy(true);
    try {
      const stage = project.stages?.find((s) => s.id === stageId);
      const roomId = stage?.room_ids?.[0] ?? null;
      await Promise.all(
        unlinked.map((r) =>
          api.patchReceipt(userId, project.id, r.id, {
            stage_id: stageId,
            room_id: r.room_id ?? roomId,
          }),
        ),
      );
      await syncProjectSideEffects({
        user: user ?? ({ id: userId } as any),
        project: activeProject ?? project,
      });
      alertReceiptsBulkLinked((user?.role === 'customer' ? 'customer' : 'contractor') as OsRole, unlinked.length);
      onDone();
    } catch {
      Alert.alert('Ошибка', 'Не удалось привязать все чеки. Проверьте сервер.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.box}>
      <Text style={s.head}>{unlinked.length} чек(ов) без этапа</Text>
      <Text style={s.hint}>Выберите этап — применится ко всем перечисленным в списке ниже</Text>
      {project.stages?.length ? (
        <StagePickerChips stages={project.stages} value={stageId} onChange={setStageId} />
      ) : null}
      <PrimaryButton
        title={busy ? 'Привязка…' : `Привязать все (${unlinked.length})`}
        variant="outline"
        disabled={busy || !stageId}
        onPress={linkAll}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { ...card, marginBottom: 12, paddingVertical: 12 },
  head: { fontWeight: '800', fontSize: 14, marginBottom: 4 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 16 },
});
