/** Приёмка above fold: фото результата → чеклист → принять/вернуть (W139: оценка только явно) */
import { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Image } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { inputField } from '@/constants/uiTokens';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { QualityScorePicker } from '@/components/renova/QualityScorePicker';
import { PhotoCompare } from '@/components/renova/PhotoCompare';
import { PhotoSwipeCompare } from '@/components/renova/PhotoSwipeCompare';
import type { StageDetail } from '@/lib/api';

type StagePhoto = StageDetail['photos'][number];
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { api } from '@/lib/api';
import { addCustomCheck } from '@/lib/customChecklist';
import { useRenova } from '@/lib/context/RenovaContext';
import { reportError } from '@/lib/reportError';

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
  /** qualityScore: null = без оценки (не подставляем 10/5) */
  onAcceptPress: (qualityScore: number | null) => void;
  onRejectPress: (qualityScore: number | null) => void;
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
  const { user, activeProject, loadProject } = useRenova();
  const contextRef = useRef({ userId: user?.id ?? null, projectId: activeProject?.id ?? null });
  contextRef.current = { userId: user?.id ?? null, projectId: activeProject?.id ?? null };
  const [newCheck, setNewCheck] = useState('');
  const [qualityScore, setQualityScore] = useState<number | null>(null);

  const reconcileCommittedStageChange = async (source: string) => {
    if (contextRef.current.userId !== userId || contextRef.current.projectId !== projectId) {
      reportError(
        `components.screens.stage.StageDetailAcceptanceFold.${source}.ContextChanged`,
        new Error('Stage acceptance context changed after commit'),
        { userId, projectId, stageId },
      );
      return;
    }
    try {
      await onReload();
    } catch (error) {
      reportError(`components.screens.stage.StageDetailAcceptanceFold.${source}.StageRefresh`, error, { projectId, stageId });
    }
    if (contextRef.current.userId !== userId || contextRef.current.projectId !== projectId) return;
    try {
      await loadProject(projectId);
    } catch (error) {
      reportError(`components.screens.stage.StageDetailAcceptanceFold.${source}.ProjectRefresh`, error, { projectId, stageId });
    }
  };

  return (
    <View style={s.wrap}>
      <Text style={s.head}>Приёмка работ</Text>
      <Text style={s.sub}>Проверьте результат по фото и чеклисту — затем примите или верните на доработку. Оценка качества не заполняется автоматически.</Text>

      {before.length > 0 || after.length > 0 ? (
        <>
          <PhotoCompare before={before} after={after} />
          {after.slice(0, 2).map((p) =>
            p.image_url ? (
              <Image key={p.id} source={{ uri: p.image_url }} style={s.previewImg} />
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
            disabled={!canWrite}
            onPress={async () => {
              if (wf) {
                try {
                  await api.toggleStageChecklist(userId, projectId, stage.id, wf.id, !wf.done);
                } catch (error: unknown) {
                  if (isOfflineQueued(error)) {
                    notifyOfflineQueued('Чеклист этапа');
                  } else {
                    reportError('components.screens.stage.StageDetailAcceptanceFold.ToggleChecklist', error, { projectId, stageId });
                  }
                  return;
                }
                await reconcileCommittedStageChange('ToggleChecklist');
              } else {
                setChecks((x) => ({ ...x, [c]: !x[c] }));
              }
            }}
          >
            <Text style={s.checkText}>{done ? '☑' : '☐'} {c}</Text>
          </Pressable>
        );
      })}

      {canWrite ? <QualityScorePicker value={qualityScore} onChange={setQualityScore} /> : null}
      <PrimaryButton
        title="Принять этап"
        disabled={acceptBlocked || !canWrite}
        onPress={() => onAcceptPress(qualityScore)}
      />
      <PrimaryButton
        title="Вернуть на доработку"
        variant="dangerOutline"
        disabled={!canWrite}
        onPress={() => onRejectPress(qualityScore)}
      />
      <PrimaryButton title="Акт приёмки (PDF)" variant="outline" onPress={onExportAcceptance} />

      <TextInput style={s.input} placeholder="Свой пункт чеклиста…" value={newCheck} onChangeText={setNewCheck} editable={canWrite} />
      <PrimaryButton
        title="Добавить пункт"
        variant="outline"
        disabled={!canWrite}
        onPress={() => {
          void (async () => {
            const text = newCheck.trim();
            if (!text) return;
            try {
              await addCustomCheck(stageId, text);
            } catch (error) {
              reportError('components.screens.stage.StageDetailAcceptanceFold.AddCustomCheck', error, { projectId, stageId });
              return;
            }
            setNewCheck('');
            if (contextRef.current.userId !== userId || contextRef.current.projectId !== projectId) return;
            try {
              await onReload();
            } catch (error) {
              reportError('components.screens.stage.StageDetailAcceptanceFold.CustomCheckRefresh', error, { projectId, stageId });
            }
          })();
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