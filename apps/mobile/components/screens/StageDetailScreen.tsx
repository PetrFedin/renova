/** Экран этапа: приёмка above fold, вторичное — в accordion */
import { formatPercentRu } from '@/lib/formatDecimal';
import { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, Pressable, Image } from 'react-native';
import { notifyAlert, notifyError } from '@/lib/notify';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import * as ImagePicker from 'expo-image-picker';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { inputField } from '@/constants/uiTokens';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, StageDetail, WorkSnapshot } from '@/lib/api';
import { isRateLimitError } from '@/lib/api/client';
import { compressUri } from '@/lib/compressImage';
import { checklistForStage } from '@/lib/checklistTemplates';
import { StageExpensePanel } from '@/components/renova/StageExpensePanel';
import { StageEstimatePanel } from '@/components/renova/StageEstimatePanel';
import { ReactionAvatars } from '@/components/renova/ReactionAvatars';
import { toggleReaction, getReaction } from '@/lib/commentReactions';
import { getCustomChecks } from '@/lib/customChecklist';
import { StageDetailLinks } from '@/components/screens/stage/StageDetailLinks';
import { StageDetailHero } from '@/components/screens/stage/StageDetailHero';
import { StageDetailAcceptanceFold } from '@/components/screens/stage/StageDetailAcceptanceFold';
import { StageDetailPaymentBlock } from '@/components/screens/stage/StageDetailPaymentBlock';
import { StageDetailAccordion } from '@/components/screens/stage/StageDetailAccordion';
import { DecisionHistoryPanel } from '@/components/renova/DecisionHistoryPanel';
import { repairTabRoute, objectTabHref } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { alertStageAcceptedForProject } from '@/lib/acceptanceNav';
import { notifyOfflineQueued, isOfflineQueued } from '@/lib/offlineUi';
import { OFFLINE_UPLOAD_BLOCKED } from '@/lib/offlineErrors';
import { isQueueableWriteError } from '@/lib/api/queueableError';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError, reportCatch } from '@/lib/reportError';
import { StageDetailExecutorChecklist } from '@/components/screens/stage/StageDetailExecutorChecklist';
import { formatScheduleDayFull } from '@/lib/formatScheduleDate';
import { formatEventDateTime } from '@/lib/formatScheduleDate';

// Шаблоны только для обычных комментариев: сдачу на приёмку запускает кнопка «Готово — на приёмку».
const TEMPLATES = ['Работы выполнены по смете', 'Нужен доступ на объект', 'Задержка из-за материалов'];

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
            disabled={!canWrite}
            onPress={async () => {
              if (user && activeProject && stageId) {
                try {
                  await api.reactComment(user.id, activeProject.id, stageId, id, r === x ? '' : x);
                  setR(r === x ? null : x);
                } catch (error) {
                  reportError('components.screens.StageDetailScreen.CommentReaction', error, { stageId, commentId: id });
                }
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
  const [contractGate, setContractGate] = useState<{ ok: boolean; reason?: string; message?: string; pending_titles?: string[] } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const stageRef = useRef<StageDetail | null>(null);
  stageRef.current = stage;
  const canWrite = useWriteAllowed();

  const reload = useCallback(async () => {
    if (!user || !activeProject || !id) return;
    try {
      const st = await api.getStage(user.id, activeProject.id, id);
      setStage(st);
      setLoadError(false);
    } catch (e) {
      // 429 / сеть: оставляем предыдущий stage, не роняем экран (Uncaught).
      // Но если stage ещё ни разу не загрузился, «Загрузка…» иначе висит
      // вечно без кнопки повтора — человек застревает на пустом экране.
      reportError(isRateLimitError(e) ? 'stage.reload.rate_limit' : 'stage.reload.getStage', e, { stageId: id });
      if (stageRef.current === null) setLoadError(true);
      return;
    }
    // Вторичные GET — с catch; при rate_limit не затираем UI fail-closed без нужды
    api.stageWorkflow(user.id, activeProject.id, id).then((w) => setWfChecks(w.checklist || [])).catch((e) => {
      reportError('components.screens.StageDetailScreen.WfChecks', e);
      if (!isRateLimitError(e)) setWfChecks([]);
    });
    api.stageBlocked(user.id, activeProject.id, id).then(setBlocked).catch((e) => {
      reportError('stage.blocked', e, { stageId: id });
      // Fail-closed только при реальной ошибке доступа/сервера — не при 429
      if (!isRateLimitError(e)) {
        setBlocked({ blocked: true, depends_on: 'load_error' });
      }
    });
    api.getContractGate(user.id, activeProject.id).then(setContractGate).catch((e) => {
      reportError('components.screens.StageDetailScreen.ContractGate', e);
      if (!isRateLimitError(e)) setContractGate(null);
    });
    api.workSnapshot(user.id, activeProject.id, id).then(setWorkSnap).catch((e) => {
      reportError('components.screens.StageDetailScreen.WorkSnap', e);
      if (!isRateLimitError(e)) setWorkSnap(null);
    });
    getCustomChecks(id).then(setCustomChecks).catch(reportCatch('stage.customChecks'));
  }, [user?.id, activeProject?.id, id]);
  useProjectDataReload(reload);

  useEffect(() => {
    reload().catch((e) => reportError('stage.reload', e, { stageId: id }));
    if (id) getCustomChecks(id).then(setCustomChecks);
    if (user && activeProject && id) {
      api.reactionCounts(user.id, activeProject.id, id).then(setReactCounts).catch(reportCatch('stage.reactions'));
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
    } catch (err) {
      notifyError('Не удалось', err, 'Акт приёмки временно недоступен. Попробуйте позже.');
    }
  };

  const runAcceptStage = async (qualityScore: number | null = null) => {
    try {
      await acceptStage(stage!.id, {
        qualityScore,
        checklist: CHECKLIST.filter((c) => {
          const wf = wfChecks.find((x) => x.text === c);
          return wf ? wf.done : !!checks[c];
        }),
      });
      await reload();
      await loadProject(activeProject!.id);
      void alertStageAcceptedForProject(role, user!.id, activeProject!.id);
    } catch (e: unknown) {
      if (isOfflineQueued(e)) notifyOfflineQueued('Приёмка');
      else {
        reportError('stage.accept', e, { stageId: stage?.id });
        showActionConfirm({
          title: 'Этап не принят',
          message: e instanceof Error && e.message ? e.message : 'Повторите попытку.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
      }
    }
  };

  const runReturnStage = async (reason: string, qualityScore: number | null): Promise<boolean> => {
    try {
      await rejectStage(stage!.id, reason, { qualityScore });
      await reload();
      showActionConfirm({
        title: 'Возвращено на доработку',
        message: 'Исполнитель увидит причину и срок доработки и сдаст этап повторно.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
      return true;
    } catch (e: unknown) {
      if (isOfflineQueued(e)) { notifyOfflineQueued('Возврат на доработку'); return true; }
      reportError('stage.return', e, { stageId: stage?.id });
      notifyError('Не удалось вернуть этап', e, 'Повторите попытку.');
      return false;
    }
  };

  const onAcceptPress = (qualityScore: number | null) => {
    if (!canWrite || acceptBlocked) return;
    // Clarity V: всегда pre-confirm (паритет hub/portal), не только при пустом чеклисте
    const emptyChecklist = CHECKLIST.length === 0;
    showActionConfirm({
      title: emptyChecklist ? 'Принять без чеклиста?' : 'Принять этап?',
      message: emptyChecklist
        ? 'Список проверок пуст. Принять этап без отметки пунктов?'
        : `«${stage?.name || 'Этап'}». После приёмки откроется цепочка оплаты.`,
      primaryLabel: 'Принять',
      onPrimary: () => { runAcceptStage(qualityScore).catch(reportCatch('stage.accept')); },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  if (!activeProject || !stage || !user) {
    if (loadError && activeProject && user) {
      return (
        <>
          <BackHeader title="Этап" returnTo={returnTo} />
          <LoadErrorState title="Не удалось загрузить этап" onRetry={() => { void reload(); }} />
        </>
      );
    }
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
      try {
        await api.addStageComment(user.id, activeProject.id, stage.id, msg);
      } catch (error: unknown) {
        if (isOfflineQueued(error)) {
          notifyOfflineQueued('Комментарий');
        } else {
          reportError('components.screens.StageDetailScreen.AddComment', error, { stageId: stage.id });
          notifyError('Комментарий', error, 'Не удалось отправить комментарий. Повторите попытку.');
        }
        return;
      }

      // Comment is committed. Reconciliation must not turn success into failure.
      setComment('');
      setReplyTo(null);
      try {
        await reload();
      } catch (error) {
        reportError('components.screens.StageDetailScreen.CommentRefresh', error, { stageId: stage.id });
      }
      try {
        await loadProject(activeProject.id);
      } catch (error) {
        reportError('components.screens.StageDetailScreen.CommentProjectRefresh', error, { stageId: stage.id });
      }
    } finally {
      setLoading(false);
    }
  };

  const onAddPhoto = async (label: string) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showActionConfirm({
        title: 'Нужен доступ к фото',
        message: 'Разрешите доступ к галерее в настройках устройства, чтобы прикрепить фото к этапу.',
        primaryLabel: 'Повторить',
        onPrimary: () => { void onAddPhoto(label); },
        secondaryLabel: 'Позже',
        onSecondary: () => undefined,
      });
      return;
    }
    const pick = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5 });
    const asset = pick.canceled ? undefined : pick.assets[0];
    if (!asset?.uri) return;

    setLoading(true);
    try {
      try {
        const compressedUri = await compressUri(asset.uri);
        const compressedResponse = await fetch(compressedUri);
        if (!compressedResponse.ok && compressedResponse.status !== 0) {
          throw new Error(`Compressed image read failed with status ${compressedResponse.status}`);
        }
        const blob = await compressedResponse.blob();
        let up: { key: string; upload_url: string | null; public_url: string } | null = null;
        try {
          up = await api.getUploadUrl(user.id, activeProject.id, 'image/jpeg');
        } catch (uploadUrlError) {
          // CMP-027: нет сети на получении upload-url — фото уходит в очередь
          // inline-base64 (addStagePhoto ставит его сам и бросает offline_queued).
          if (!isQueueableWriteError(uploadUrlError)) throw uploadUrlError;
          if (!asset.base64) throw new Error(OFFLINE_UPLOAD_BLOCKED);
          await api.addStagePhoto(user.id, activeProject.id, stage.id, `data:image/jpeg;base64,${asset.base64}`, label);
        }
        if (up === null) {
          // фото уже отправлено/поставлено в очередь веткой выше
        } else if (up.upload_url) {
          let uploaded = false;
          try {
            const uploadResponse = await fetch(up.upload_url, {
              method: 'PUT',
              body: blob,
              headers: { 'Content-Type': 'image/jpeg' },
            });
            if (!uploadResponse.ok) {
              throw new Error(`Stage photo upload failed with status ${uploadResponse.status}`);
            }
            uploaded = true;
          } catch (putError) {
            // Обрыв во время PUT (fetch бросает TypeError) — тот же офлайн-путь.
            if (!(putError instanceof TypeError) || !asset.base64) throw putError;
          }
          if (uploaded) {
            await api.addStagePhoto(user.id, activeProject.id, stage.id, undefined, label, up.key, up.public_url);
          } else {
            await api.addStagePhoto(user.id, activeProject.id, stage.id, `data:image/jpeg;base64,${asset.base64}`, label);
          }
        } else if (asset.base64) {
          await api.addStagePhoto(user.id, activeProject.id, stage.id, `data:image/jpeg;base64,${asset.base64}`, label);
        } else {
          throw new Error('Stage photo upload URL unavailable and no inline image fallback exists');
        }
      } catch (error: unknown) {
        if (isOfflineQueued(error)) {
          notifyOfflineQueued('Фото');
        } else {
          reportError('components.screens.StageDetailScreen.AddPhoto', error, { stageId: stage.id, label });
          notifyError('Фото', error, 'Не удалось загрузить фото. Запись этапа не изменена — повторите попытку.');
        }
        return;
      }

      // Photo metadata is committed only after a successful storage PUT (or the
      // explicit inline fallback). Refresh failures are separate telemetry.
      try {
        await reload();
      } catch (error) {
        reportError('components.screens.StageDetailScreen.PhotoRefresh', error, { stageId: stage.id });
      }
      try {
        await loadProject(activeProject.id);
      } catch (error) {
        reportError('components.screens.StageDetailScreen.PhotoProjectRefresh', error, { stageId: stage.id });
      }
    } finally {
      setLoading(false);
    }
  };

  // Те же слова, что и в проверке готовности на сервере (work_snapshot_service): иначе блок «После» и гейт расходятся.
  const isAfterPhoto = (caption?: string | null) => /после|after|результат/i.test(caption || '');
  const before = stage.photos.filter((p) => !isAfterPhoto(p.caption) && (p.caption || '').toLowerCase().includes('до'));
  const after = stage.photos.filter((p) => isAfterPhoto(p.caption));
  const other = stage.photos.filter((p) => !before.includes(p) && !after.includes(p));
  const isArchived = stage.status === 'done';
  const showAcceptance = role === 'customer' && stage.status === 'review';

  return (
    <>
      <BackHeader
        title={stage.name}
        returnTo={returnTo}
        // Статус показывает карточка этапа ниже — в шапке не дублируем.
        subtitle={isArchived ? 'Архив' : undefined}
      />
      <ReadOnlyBanner />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {isArchived && (
          <View style={styles.archiveBanner}>
            <Text style={styles.archiveText}>Этап завершён</Text>
            <Pressable onPress={() => pushOsNav(repairTabRoute(role, 'works', 'archive'), undefined, role)}>
              <Text style={styles.link}>→ Архив этапов</Text>
            </Pressable>
            <PrimaryButton title="Акт приёмки (PDF)" variant="outline" compact onPress={() => { onExportAcceptance().catch(reportCatch('stage.exportAcceptance')); }} />
          </View>
        )}

        <StageDetailHero
          stage={stage}
          workSnap={workSnap}
          isContractor={isContractor}
          canWrite={canWrite}
          blocked={blocked}
          contractGate={contractGate}
          onContractCreated={() => {
            api.getContractGate(user.id, activeProject.id).then(setContractGate).catch(reportCatch('stage.contractGate'));
          }}
          userId={user.id}
          projectId={activeProject.id}
          onReload={reload}
          onProjectReload={() => loadProject(activeProject.id)}
          onSubmitStage={submitStage}
        />

        {isContractor && stage.status === 'active' && wfChecks.length > 0 ? (
          <StageDetailExecutorChecklist
            stageId={stage.id}
            checks={wfChecks}
            canWrite={canWrite}
            userId={user.id}
            projectId={activeProject.id}
            onChanged={async () => { await reload(); await loadProject(activeProject.id); }}
          />
        ) : null}

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
            onReturnPress={(reason, qualityScore) => runReturnStage(reason, qualityScore).catch((e) => { reportCatch('stage.return')(e); return false; })}
            onExportAcceptance={() => { onExportAcceptance().catch(reportCatch('stage.exportAcceptance')); }}
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
            reload().catch((e) => reportError('stage.reload', e, { stageId: id }));
            loadProject(activeProject.id).catch(reportCatch('stage.loadProject'));
          }}
        />

        <StageDetailAccordion title="Фото до / после" summary={`${stage.photos.length} фото`}>
          <View style={styles.photoBtns}>
            <PrimaryButton disabled={!canWrite || loading} title="До работ" variant="outline" onPress={() => { void onAddPhoto('До работ'); }} />
            <PrimaryButton disabled={!canWrite || loading} title="После работ" variant="outline" onPress={() => { void onAddPhoto('После работ'); }} />
          </View>
          {[{ title: 'До', list: before }, { title: 'После', list: after }, { title: 'Прочие', list: other }].map(
            ({ title, list }) =>
              list.length > 0 && (
                <View key={title}>
                  <Text style={styles.subSection}>{title}</Text>
                  {list.map((p) => (
                    <View key={p.id} style={styles.photoRow}>
                      {p.image_url ? (
                        <Image source={{ uri: p.image_url }} style={styles.img} />
                      ) : null}
                      <Text>{p.caption || 'Фото'} · {formatScheduleDayFull(p.created_at)}</Text>
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
            role={role}
            returnTo={`/stage/${stage.id}`}
          />
        </StageDetailAccordion>

        <StageDetailAccordion title="Комментарии" summary={`${stage.comments.length} сообщ.`}>
          {isContractor && (
            <View style={styles.tplRow}>
              {TEMPLATES.map((t) => (
                <Pressable key={t} style={styles.tpl} onPress={() => { void onAddComment(t); }}>
                  <Text style={styles.tplT}>{t}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {stage.comments.map((c) => (
            <Pressable key={c.id} style={styles.comment} onPress={() => setReplyTo(c.text)}>
              <Text style={styles.commentRole}>{c.author_role === 'contractor' ? 'Исполнитель' : c.author_role === 'supervisor' ? 'Технадзор' : 'Заказчик'}</Text>
              {renderComment(c.text)}
              <CommentReactions id={c.id} stageId={stage.id} counts={reactCounts[c.id]} />
              <Text style={styles.meta}>{formatEventDateTime(c.created_at)}</Text>
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
          <PrimaryButton disabled={!canWrite || loading} title="Отправить" onPress={() => { void onAddComment(); }} />
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
          <StageDetailAccordion title="Прогресс" summary={formatPercentRu(workSnap.percent_complete)}>
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
