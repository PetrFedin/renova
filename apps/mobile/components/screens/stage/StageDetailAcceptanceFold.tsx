/** Приёмка above fold: фото результата → чеклист → принять/вернуть */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Image } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { inputField } from '@/constants/uiTokens';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { PhotoCompare } from '@/components/renova/PhotoCompare';
import { PhotoSwipeCompare } from '@/components/renova/PhotoSwipeCompare';
import type { StageDetail } from '@/lib/api';

type StagePhoto = StageDetail['photos'][number];
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { api } from '@/lib/api';
import { addCustomCheck } from '@/lib/customChecklist';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useRenova } from '@/lib/context/RenovaContext';

type WfCheck = { id: string; text: string; done: boolean };

type Props = {
  stage: StageDetail;
  stageId: string;
  checklist: string[];
  wfChecks: WfCheck[];
  checks: Record<string, boolean>;
  setChecks: (fn: (x: Record<string, boolean>) => Record<string, boolean>) => void;
  acceptBlocked: boolean;
  canWrite: boolean;
  userId: string;
  projectId: string;
  before: StagePhoto[];
  after: StagePhoto[];
  swipeOpen: boolean;
  setSwipeOpen: (v: boolean) => void;
  onAcceptPress: () => void;
  onRejectPress: () => void;
  onExportAcceptance: () => void;
  onReload: () => Promise<void>;
};

export function StageDetailAcceptanceFold({
  stage,
  stageId,
  checklist,
  wfChecks,
  checks,
  setChecks,
  acceptBlocked,
  canWrite,
  userId,
  projectId,
  before,
  after,
  swipeOpen,
  setSwipeOpen,
  onAcceptPress,
  onRejectPress,
  onExportAcceptance,
  onReload,
}: Props) {
  const { user, activeProject } = useRenova();
  const [newCheck, setNewCheck] = useState('');
  const syncAfter = () =>
    syncProjectSideEffects({
      user: user ?? ({ id: userId } as any),
      project: activeProject ?? ({ id: projectId } as any),
    });

  return (
    <View style={s.wrap}>
      <Text style={s.head}>Приёмка работ</Text>
      <Text style={s.sub}>Проверьте результат по фото и чеклисту — затем примите или верните на доработку.</Text>

      {before.length > 0 || after.length > 0 ? (
        <>
          <PhotoCompare before={before} after={after} />
          {after.slice(0, 2).map((p) =>
            (p as { image_url?: string }).image_url ? (
              <Image key={p.id} source={{ uri: (p as { image_url: string }).image_url }} style={s.previewImg} />
            ) : null,
          )}
          <PrimaryButton title="Полноэкранное сравнение" variant="outline" onPress={() => setSwipeOpen(true)} />
          <PhotoSwipeCompare before={before} after={after} visible={swipeOpen} onClose={() => setSwipeOpen(false)} />
        </>
      ) : (
        <Text style={s.meta}>Фото «до/после» пока нет — попросите исполнителя добавить в разделе ниже.</Text>
      )}

      <Text style={s.section}>Чеклист</Text>
      {checklist.map((c) => {
        const wf = wfChecks.find((x) => x.text === c);
        const done = wf ? wf.done : !!checks[c];
        return (
          <Pressable
            key={c}
            style={s.checkRow}
            onPress={async () => {
              if (wf) {
                try {
                  await api.toggleStageChecklist(userId, projectId, stage.id, wf.id, !wf.done);
                  await onReload();
                  await syncAfter();
                } catch (e) {
                  if (isOfflineQueued(e)) notifyOfflineQueued('Чеклист этапа');
                }
              } else {
                setChecks((x) => ({ ...x, [c]: !x[c] }));
              }
            }}
          >
            <Text style={s.checkText}>{done ? '☑' : '☐'} {c}</Text>
          </Pressable>
        );
      })}

      <PrimaryButton title="Принять этап" disabled={acceptBlocked || !canWrite} onPress={onAcceptPress} />
      <PrimaryButton title="Вернуть на доработку" variant="dangerOutline" disabled={!canWrite} onPress={onRejectPress} />
      <PrimaryButton title="Акт приёмки (PDF)" variant="outline" onPress={onExportAcceptance} />

      <TextInput style={s.input} placeholder="Свой пункт чеклиста…" value={newCheck} onChangeText={setNewCheck} />
      <PrimaryButton
        title="Добавить пункт"
        variant="outline"
        onPress={async () => {
          if (!newCheck.trim()) return;
          await addCustomCheck(stageId, newCheck);
          setNewCheck('');
          await onReload();
          await syncAfter();
        }}
      />

      {acceptBlocked ? <Text style={s.meta}>Нужны фото результата и отмеченный чеклист (если есть пункты)</Text> : null}
      {!acceptBlocked && checklist.length === 0 ? (
        <Text style={s.meta}>Чеклист пуст — при приёмке будет запрос подтверждения</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: RenovaTheme.spacing.md, gap: 8 },
  head: { fontSize: RenovaTheme.fontSize.h2, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  sub: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  section: { fontWeight: RenovaTheme.fontWeight.bold, fontSize: RenovaTheme.fontSize.h3, marginTop: 8 },
  checkRow: { ...card, padding: 10 },
  checkText: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.text },
  input: { ...inputField, minHeight: 44 },
  meta: { color: RenovaTheme.colors.textMuted, fontSize: RenovaTheme.fontSize.bodySmall },
  previewImg: { width: '100%', height: 140, borderRadius: RenovaTheme.radius.md },
});
