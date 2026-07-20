/** Экран этапа: приёмка above fold, вторичное — в accordion */
import { useEffect, useState, useCallback } from 'react';
import { ScrollView, View, Text, Alert, TextInput, StyleSheet, Pressable, Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import * as ImagePicker from 'expo-image-picker';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { inputField } from '@/constants/uiTokens';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, StageDetail, WorkSnapshot } from '@/lib/api';
import { compressUri } from '@/lib/compressImage';
import { checklistForStage } from '@/lib/checklistTemplates';
import { StageExpensePanel } from '@/components/renova/StageExpensePanel';
import { StageEstimatePanel } from '@/components/renova/StageEstimatePanel';
import { ReactionAvatars } from '@/components/renova/ReactionAvatars';
import { toggleReaction, getReaction } from '@/lib/commentReactions';
import { getCustomChecks } from '@/lib/customChecklist';
import { RejectStageModal } from '@/components/renova/RejectStageModal';
import { StageDetailLinks } from '@/components/screens/stage/StageDetailLinks';
import { StageDetailHero } from '@/components/screens/stage/StageDetailHero';
import { StageDetailAcceptanceFold } from '@/components/screens/stage/StageDetailAcceptanceFold';
import { StageDetailPaymentBlock } from '@/components/screens/stage/StageDetailPaymentBlock';
import { StageDetailAccordion } from '@/components/screens/stage/StageDetailAccordion';
import { DecisionHistoryPanel } from '@/components/renova/DecisionHistoryPanel';
import { repairTabRoute, objectTabHref } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { notifyOfflineQueued, isOfflineQueued } from '@/lib/offlineUi';
import { STAGE_STATUS_LABEL } from '@/constants/labels';

const TEMPLATES = ['@заказчик готово к приёмке', 'Работы выполнены по смете', 'Нужен доступ на объект', 'Задержка из-за материалов', 'Готово к приёмке'];

function renderComment(text: string) {
  if (text.startsWith('↩')) return <Text style={{ fontStyle: 'italic', color: RenovaTheme.colors.textMuted }}>{text}</Text>;
  const parts = text.split(/(@\S+)/g);
  return (
    <Text>
      {parts.map((p, i) =>
        p.startsWith('@') ? (
          <Text key={i} style={{ fontWeight: '700', color: RenovaTheme.colors.primary }}>{p}</Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

function CommentReactions({ id, stageId, counts }: { id: string; stageId: string; counts?: Record<string, unknown> }) {
  const canWrite = useWriteAllowed();
  const { user, activeProject } = useRenova();
  const [r, setR] = useState<string | null>(null);
  useEffect(() => { getReaction(id).then(setR); }, [id]);
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        {(['👍', '❓'] as const).map((x) => (
          <Pressable
            key={x}
            onPress={async () => {
              if (user && activeProject && stageId) {
                await api.reactComment(user.id, activeProject.id, stageId, id, r === x ? '' : x);
                setR(r === x ? null : x);
              } else {
                setR(await toggleReaction(id, x));
              }
            }}
          >
            <Text style={{ opacity: r === x ? 1 : 0.4 }}>{x}</Text>
          </Pressable>
        ))}
      </View>
      {(counts as { users?: unknown })?.users ? <ReactionAvatars reactions={(counts as { users: unknown }).users as never} /> : null}
    </>
  );
}

export function StageDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { user, activeProject, loadProject, submitStage, acceptStage, rejectStage, readOnly } = useRenova();
  const [blocked, setBlocked] = useState<{ blocked: boolean; depends_on?: string } | null>(null);
  const [stage, setStage] = useState<StageDetail | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [swipeOpen, setSwipeOpen] = useState(false);
  const [reactCounts, setReactCounts] = useState<Record<string, Record<string, number>>>({});
  const [customChecks, setCustomChecks] = useState<string[]>([]);
  const [wfChecks, setWfChecks] = useState<{ id: string; text: string; done: boolean }[]>([]);
  const [workSnap, setWorkSnap] = useState<WorkSnapshot | null>(null);
  const [contractGate, setContractGate] = useState<{ ok: boolean; message?: string; pending_titles?: string[] } | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const canWrite = useWriteAllowed();

  const reload = useCallback(async () => {
    if (!user || !activeProject || !id) return;
    const st = await api.getStage(user.id, activeProject.id, id);
    setStage(st);
    api.stageWorkflow(user.id, activeProject.id, id).then((w) => setWfChecks(w.checklist || [])).catch(() => setWfChecks([]));
    api.stageBlocked(user.id, activeProject.id, id).then(setBlocked).catch(() => {});
    api.getContractGate(user.id, activeProject.id).then(setContractGate).catch(() => setContractGate(null));
    api.workSnapshot(user.id, activeProject.id, id).then(setWorkSnap).catch(() => setWorkSnap(null));
    getCustomChecks(id).then(setCustomChecks).catch(() => {});
  }, [user?.id, activeProject?.id, id]);
  useProjectDataReload(reload);

  useEffect(() => {
    reload().catch(() => {});
    if (id) getCustomChecks(id).then(setCustomChecks);
    if (user && activeProject && id) {
      api.reactionCounts(user.id, activeProject.id, id).then(setReactCounts).catch(() => {});
    }
  }, [user?.id, activeProject?.id, id]);

  const isContractor = user?.role === 'contractor';
  const role = isContractor ? 'contractor' as const : 'customer' as const;
  const CHECKLIST = wfChecks.length ? wfChecks.map((c) => c.text) : [...checklistForStage(stage?.name || ''), ...customChecks];
  const checklistComplete =
    CHECKLIST.length === 0
      ? true
      : wfChecks.length
        ? wfChecks.every((c) => c.done)
        : CHECKLIST.every((c) => checks[c]);
  // W68 #44: без фото результата кнопка неактивна
  const hasResultPhoto = (stage?.photos?.length ?? 0) > 0;
  const acceptBlocked = (CHECKLIST.length > 0 && !checklistComplete) || !hasResultPhoto;
  const exportChecks = wfChecks.length
    ? wfChecks.filter((c) => c.done).map((c) => c.text)
    : CHECKLIST.filter((c) => checks[c]);

  const onExportAcceptance = async () => {
    if (!user || !activeProject || !stage) return;
    try {
      await api.exportStageAcceptance(user.id, activeProject.id, stage.id, exportChecks);
    } catch {
      Alert.alert('Не удалось', 'Акт приёмки временно недоступен. Попробуйте позже.');
    }
  };

  const runAcceptStage = async () => {
    try {
      await acceptStage(stage!.id);
      await reload();
      await loadProject(activeProject!.id);
    } catch (e: unknown) {
      if (isOfflineQueued(e)) notifyOfflineQueued('Приёмка');
      else throw e;
    }
  };

  const onAcceptPress = () => {
    if (!canWrite || acceptBlocked) return;
    if (CHECKLIST.length === 0) {
      Alert.alert(
        'Принять без чеклиста?',
        'Список проверок пуст. Принять этап без отметки пунктов?',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Принять', onPress: () => { runAcceptStage().catch(() => {}); } },
        ],
      );
      return;
    }
    runAcceptStage().catch(() => {});
  };

  if (!activeProject || !stage || !user) {
    return (
      <>
        <BackHeader title="Этап" returnTo={returnTo} />
        <View style={styles.center}><Text>Загрузка…</Text></View>
      </>
    );
  }

  const onAddComment = async (text?: string) => {
    const t = (text ?? comment).trim();
    if (!t) return;
    setLoading(true);
    const msg = replyTo ? `↩ "${replyTo.slice(0, 80)}"\n${t}` : t;
    try {
      await api.addStageComment(user.id, activeProject.id, stage.id, msg);
      setComment('');
      setReplyTo(null);
      await reload();
      await syncProjectSideEffects({ user, project: activeProject });
    } catch (e: unknown) {
      if (isOfflineQueued(e)) notifyOfflineQueued('Комментарий');
      else throw e;
    } finally {
      setLoading(false);
    }
  };

  const onAddPhoto = async (label: string) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const pick = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5 });
    if (pick.canceled || !pick.assets[0]?.base64) return;
    setLoading(true);
    try {
      const up = await api.getUploadUrl(user.id);
      if (up.upload_url && pick.assets[0].uri) {
        const blob = await compressUri(await fetch(pick.assets[0].uri).then((r) => r.blob()));
        await fetch(up.upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
        await api.addStagePhoto(user.id, activeProject.id, stage.id, undefined, label, up.key, up.public_url);
      } else {
        await api.addStagePhoto(user.id, activeProject.id, stage.id, `data:image/jpeg;base64,${pick.assets[0].base64}`, label);
      }
      await reload();
      await syncProjectSideEffects({ user, project: activeProject });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'offline_queued') {
        Alert.alert('Офлайн', 'Фото отправится при подключении');
      } else throw e;
    } finally {
      setLoading(false);
    }
  };

  const before = stage.photos.filter((p) => (p.caption || '').toLowerCase().includes('до'));
  const after = stage.photos.filter((p) => (p.caption || '').toLowerCase().includes('после'));
  const other = stage.photos.filter((p) => !before.includes(p) && !after.includes(p));
  const isArchived = stage.status === 'done';
  const showAcceptance = role === 'customer' && stage.status === 'review';

  return (
    <>
      <BackHeader
        title={stage.name}
        returnTo={returnTo}
        subtitle={`${STAGE_STATUS_LABEL[stage.status] || stage.status}${isArchived ? ' · Архив' : ''}`}
      />
      <ReadOnlyBanner />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {isArchived && (
          <View style={styles.archiveBanner}>
            <Text style={styles.archiveText}>Этап завершён</Text>
            <Pressable onPress={() => pushOsNav(repairTabRoute(role, 'works', 'archive'))}>
              <Text style={styles.link}>→ Архив этапов</Text>
            </Pressable>
          </View>
        )}

        <StageDetailHero
          stage={stage}
          workSnap={workSnap}
          isContractor={isContractor}
          canWrite={canWrite}
          blocked={blocked}
          contractGate={contractGate}
          userId={user.id}
          projectId={activeProject.id}
          onReload={reload}
          onProjectReload={() => loadProject(activeProject.id)}
          onSubmitStage={submitStage}
        />

        {showAcceptance ? (
          <StageDetailAcceptanceFold
            stage={stage}
            stageId={id!}
            checklist={CHECKLIST}
            wfChecks={wfChecks}
            checks={checks}
            setChecks={setChecks}
            acceptBlocked={acceptBlocked}
            canWrite={canWrite}
            userId={user.id}
            projectId={activeProject.id}
            before={before}
            after={after}
            swipeOpen={swipeOpen}
            setSwipeOpen={setSwipeOpen}
            onAcceptPress={onAcceptPress}
            onRejectPress={() => setRejectOpen(true)}
            onExportAcceptance={() => { onExportAcceptance().catch(() => {}); }}
            onReload={reload}
          />
        ) : null}

        <StageDetailPaymentBlock
          stageId={stage.id}
          stageStatus={stage.status}
          stagePaymentAmount={stage.payment_amount}
          userId={user.id}
          projectId={activeProject.id}
          role={role}
          readOnly={readOnly}
          stages={activeProject.stages || []}
          onChanged={() => {
            reload().catch(() => {});
            loadProject(activeProject.id).catch(() => {});
          }}
        />

        <StageDetailAccordion title="Фото до / после" summary={`${stage.photos.length} фото`}>
          <View style={styles.photoBtns}>
            <PrimaryButton disabled={!canWrite || loading} title="До работ" variant="outline" onPress={() => onAddPhoto('До работ')} />
            <PrimaryButton disabled={!canWrite || loading} title="После работ" variant="outline" onPress={() => onAddPhoto('После работ')} />
          </View>
          {[{ title: 'До', list: before }, { title: 'После', list: after }, { title: 'Прочие', list: other }].map(
            ({ title, list }) =>
              list.length > 0 && (
                <View key={title}>
                  <Text style={styles.subSection}>{title}</Text>
                  {list.map((p) => (
                    <View key={p.id} style={styles.photoRow}>
                      {(p as { image_url?: string }).image_url ? (
                        <Image source={{ uri: (p as { image_url: string }).image_url }} style={styles.img} />
                      ) : null}
                      <Text>{p.caption || 'Фото'} · {p.created_at.slice(0, 10)}</Text>
                    </View>
                  ))}
                </View>
              ),
          )}
        </StageDetailAccordion>

        <StageDetailAccordion title="Расходы и смета" summary="Детализация по этапу">
          <StageExpensePanel
            userId={user.id}
            projectId={activeProject.id}
            project={activeProject}
            role={role}
            stageId={stage.id}
            stageName={stage.name}
            roomIds={stage.room_ids}
            readOnly={!canWrite}
          />
          <StageEstimatePanel
            lines={activeProject.estimate_lines || []}
            rooms={activeProject.rooms || []}
            roomIds={stage.room_ids}
            estimateHref={objectTabHref(role, 'estimate')}
          />
        </StageDetailAccordion>

        <StageDetailAccordion title="Комментарии" summary={`${stage.comments.length} сообщ.`}>
          {isContractor && (
            <View style={styles.tplRow}>
              {TEMPLATES.map((t) => (
                <Pressable key={t} style={styles.tpl} onPress={() => onAddComment(t)}>
                  <Text style={styles.tplT}>{t}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {stage.comments.map((c) => (
            <Pressable key={c.id} style={styles.comment} onPress={() => setReplyTo(c.text)}>
              <Text style={styles.commentRole}>{c.author_role === 'contractor' ? 'Исполнитель' : 'Заказчик'}</Text>
              {renderComment(c.text)}
              <CommentReactions id={c.id} stageId={stage.id} counts={reactCounts[c.id]} />
              <Text style={styles.meta}>{c.created_at.slice(0, 16).replace('T', ' ')}</Text>
            </Pressable>
          ))}
          {replyTo ? (
            <Text style={styles.meta}>
              Ответ на: {replyTo.slice(0, 40)}… <Text onPress={() => setReplyTo(null)}>✕</Text>
            </Text>
          ) : null}
          <TextInput
            editable={canWrite}
            style={styles.input}
            placeholder="Комментарий…"
            value={comment}
            onChangeText={setComment}
            multiline
          />
          <PrimaryButton disabled={!canWrite || loading} title="Отправить" onPress={() => onAddComment()} />
        </StageDetailAccordion>

        <StageDetailAccordion title="История решений" summary="Смета · сроки · согласования">
          <DecisionHistoryPanel
            userId={user.id}
            projectId={activeProject.id}
            stageId={stage.id}
            compact
            returnTo={returnTo}
          />
        </StageDetailAccordion>

        <StageDetailAccordion title="Связанные разделы" summary="Этапы · бюджет · чат">
          <StageDetailLinks
            role={role}
            user={user}
            project={activeProject}
            stage={stage}
            stageId={id!}
            canWrite={canWrite}
            onRoomsChanged={reload}
          />
        </StageDetailAccordion>

        {workSnap ? (
          <StageDetailAccordion title="Прогресс" summary={`${workSnap.percent_complete}%`}>
            <Text style={styles.meta}>
              Работ: {workSnap.works_done ?? workSnap.checklist_progress?.done ?? 0}/{workSnap.works_total ?? workSnap.checklist_progress?.total ?? 0}
              {' · '}материалы {workSnap.materials_count}
              {workSnap.overdue_days ? ` · +${workSnap.overdue_days} дн.` : ''}
            </Text>
            {workSnap.budget ? (
              <Text style={styles.meta}>
                Бюджет: {formatRub(workSnap.budget.planned)} · факт {formatRub(workSnap.budget.spent)}
              </Text>
            ) : null}
          </StageDetailAccordion>
        ) : null}
      </ScrollView>

      <RejectStageModal
        visible={rejectOpen}
        stageName={stage.name}
        onClose={() => setRejectOpen(false)}
        onConfirm={async (reason) => {
          setRejectOpen(false);
          try {
            await rejectStage(stage.id, reason);
            await reload();
          } catch (e: unknown) {
            if (e instanceof Error && e.message === 'offline_queued') {
              Alert.alert('Офлайн', 'Отклонение отправится при подключении');
            } else {
              Alert.alert('Ошибка', 'Не удалось вернуть этап на доработку');
            }
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  archiveBanner: { ...card, backgroundColor: RenovaTheme.colors.surfaceMuted, marginBottom: 8 },
  archiveText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, fontWeight: RenovaTheme.fontWeight.semibold, marginBottom: 4 },
  link: { color: RenovaTheme.colors.accent, paddingVertical: 4, fontWeight: RenovaTheme.fontWeight.semibold },
  meta: { color: RenovaTheme.colors.textMuted, marginTop: 4, fontSize: RenovaTheme.fontSize.bodySmall },
  subSection: { fontWeight: RenovaTheme.fontWeight.semibold, marginTop: 10, marginBottom: 4 },
  comment: { ...card, padding: 10 },
  commentRole: { fontSize: RenovaTheme.fontSize.tiny, color: RenovaTheme.colors.textMuted, fontWeight: RenovaTheme.fontWeight.semibold },
  input: { ...inputField, minHeight: 60, marginVertical: RenovaTheme.spacing.sm },
  tplRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: RenovaTheme.spacing.sm },
  tpl: { backgroundColor: RenovaTheme.colors.infoBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RenovaTheme.radius.pill, borderWidth: 1, borderColor: RenovaTheme.colors.infoBorder },
  tplT: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.infoText },
  photoBtns: { flexDirection: 'row', gap: RenovaTheme.spacing.sm, marginBottom: RenovaTheme.spacing.sm },
  photoRow: { ...card, padding: 10, marginTop: RenovaTheme.spacing.sm },
  img: { width: '100%', height: 160, borderRadius: 8, marginBottom: 6 },
});
