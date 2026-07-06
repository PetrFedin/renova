/** Экран этапа: чеклист приёмки, шаблоны комментариев, фото до/после */
import { useEffect, useState } from 'react';
import { ScrollView, View, Text, Alert, TextInput, StyleSheet, Pressable, Image } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import * as ImagePicker from 'expo-image-picker';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { inputField } from '@/constants/uiTokens';
import { WorkTypeFilter } from '@/components/renova/WorkTypeFilter';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, StageDetail, WorkSnapshot, ApiError } from '@/lib/api';
import { compressUri } from '@/lib/compressImage';
import { checklistForStage } from '@/lib/checklistTemplates';
import { StageExpensePanel } from '@/components/renova/StageExpensePanel';
import { StageEstimatePanel } from '@/components/renova/StageEstimatePanel';
import { roomTypeLabel } from '@/constants/roomTypes';
import { ReactionAvatars } from '@/components/renova/ReactionAvatars';
import { toggleReaction, getReaction } from '@/lib/commentReactions';
import { recordVoiceStub } from '@/lib/voiceRecord';
import { getCustomChecks, addCustomCheck } from '@/lib/customChecklist';
import { PhotoCompare } from '@/components/renova/PhotoCompare';
import { PhotoSwipeCompare } from '@/components/renova/PhotoSwipeCompare';
import { RejectStageModal } from '@/components/renova/RejectStageModal';
import { StageDetailLinks } from '@/components/screens/stage/StageDetailLinks';

import { STAGE_STATUS_LABEL } from '@/constants/labels';
import { repairTabRoute, objectTabHref } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { notifyOfflineQueued, isOfflineQueued } from '@/lib/offlineUi';

const STATUS = STAGE_STATUS_LABEL;
function renderComment(text: string) {
  if (text.startsWith('↩')) return <Text style={{ fontStyle:'italic', color:'#555' }}>{text}</Text>;
  const parts = text.split(/(@\S+)/g);
  return <Text>{parts.map((p, i) => (p.startsWith('@') ? <Text key={i} style={{ fontWeight: '700', color: RenovaTheme.colors.primary }}>{p}</Text> : p))}</Text>;
}

const TEMPLATES = ['@заказчик готово к приёмке', 'Работы выполнены по смете', 'Нужен доступ на объект', 'Задержка из-за материалов', 'Готово к приёмке'];

function CommentReactions({ id, stageId, counts }: { id: string; stageId: string; counts?: any }) {
  const canWrite = useWriteAllowed();
  const { user, activeProject } = useRenova();
  const [r, setR] = useState<string | null>(null);
  useEffect(() => { getReaction(id).then(setR); }, [id]);
  return (<><View style={{ flexDirection:'row', gap:8, marginTop:4 }}>{(['👍','❓'] as const).map(x => (<Pressable key={x} onPress={async () => { if(user&&activeProject&&stageId) { await api.reactComment(user.id, activeProject.id, stageId, id, r===x?'':x); setR(r===x?null:x); } else setR(await toggleReaction(id, x)); }}><Text style={{ opacity: r===x?1:0.4 }}>{x}</Text></Pressable>))}</View>{counts?.users && <ReactionAvatars reactions={counts.users} />}
            {counts?.counts && <Text style={{ fontSize:10, color:'#888' }}>{Object.entries(counts).map(([k,v])=>`${k}${v}`).join(' ')}</Text>}</>);
}

export function StageDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { user, activeProject, loadProject, submitStage, acceptStage, rejectStage } = useRenova();
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
  const [newCheck, setNewCheck] = useState('');
  const [workSnap, setWorkSnap] = useState<WorkSnapshot | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const canWrite = useWriteAllowed();

  const reload = async () => {
    if (!user || !activeProject || !id) return;
    const st = await api.getStage(user.id, activeProject.id, id); setStage(st);
    api.stageWorkflow(user.id, activeProject.id, id).then((w) => setWfChecks(w.checklist || [])).catch(() => setWfChecks([]));
    api.stageBlocked(user.id, activeProject.id, id).then(setBlocked).catch(()=>{});
    api.workSnapshot(user.id, activeProject.id, id).then(setWorkSnap).catch(() => setWorkSnap(null));
  };

  useEffect(() => { reload().catch(() => {}); if (id) getCustomChecks(id).then(setCustomChecks); if (user && activeProject && id) api.reactionCounts(user.id, activeProject.id, id).then(setReactCounts).catch(()=>{}); }, [user?.id, activeProject?.id, id]);

  const tabs = user?.role === 'contractor' ? '/(contractor)/(tabs)' : '/(customer)/(tabs)';
  const isContractor = user?.role === 'contractor';
  const CHECKLIST = wfChecks.length ? wfChecks.map((c) => c.text) : [...checklistForStage(stage?.name || ''), ...customChecks];
  const checklistComplete =
    CHECKLIST.length === 0
      ? true
      : wfChecks.length
        ? wfChecks.every((c) => c.done)
        : CHECKLIST.every((c) => checks[c]);
  const acceptBlocked = CHECKLIST.length > 0 && !checklistComplete;
  const exportChecks = wfChecks.length
    ? wfChecks.filter((c) => c.done).map((c) => c.text)
    : CHECKLIST.filter((c) => checks[c]);

  const onExportAcceptance = async () => {
    if (!user || !activeProject) return;
    try {
      await api.exportStageAcceptance(user.id, activeProject.id, stage!.id, exportChecks);
    } catch {
      Alert.alert('Не удалось', 'Акт приёмки временно недоступен. Попробуйте позже.');
    }
  };

  const runAcceptStage = async () => {
    try {
      await acceptStage(stage!.id);
      await reload();
      await loadProject(activeProject!.id);
    } catch (e: any) {
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

  if (!activeProject || !stage) {
    return (<><BackHeader title="Этап" returnTo={returnTo} /><View style={styles.center}><Text>Загрузка…</Text></View></>);
  }

  const onAddComment = async (text?: string) => {
    const t = (text ?? comment).trim();
    if (!user || !t) return;
    setLoading(true);
    const msg = replyTo ? `↩ "${replyTo.slice(0,80)}"\n${t}` : t;
    try { await api.addStageComment(user.id, activeProject.id, stage.id, msg); setComment(''); setReplyTo(null); await reload(); } catch (e: unknown) { if (isOfflineQueued(e)) notifyOfflineQueued('Комментарий'); else throw e; }
    finally { setLoading(false); }
  };

  const onAddPhoto = async (label: string) => {
    if (!user) return;
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
    } catch (e: any) {
      if (e?.message === 'offline_queued') Alert.alert('Офлайн', 'Фото отправится при подключении');
      else throw e;
    } finally { setLoading(false); }
  };

  const before = stage.photos.filter((p) => (p.caption || '').toLowerCase().includes('до'));
  const after = stage.photos.filter((p) => (p.caption || '').toLowerCase().includes('после'));
  const other = stage.photos.filter((p) => !before.includes(p) && !after.includes(p));
  const role = isContractor ? 'contractor' as const : 'customer' as const;
  const isArchived = stage.status === 'done';

  return (
    <>
      <BackHeader title={stage.name} returnTo={returnTo} subtitle={`${STATUS[stage.status] || stage.status}${isArchived ? ' · Архив' : ''}`} />
      <ReadOnlyBanner />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
        {isArchived && (
          <View style={styles.archiveBanner}>
            <Text style={styles.archiveText}>Этап завершён и в архиве</Text>
            <Pressable onPress={() => pushOsNav(repairTabRoute(role, 'works', 'archive'))}>
              <Text style={styles.link}>→ Все архивные этапы</Text>
            </Pressable>
          </View>
        )}
        {user && (
          <StageDetailLinks
            role={role}
            user={user}
            project={activeProject}
            stage={stage}
            stageId={id!}
            canWrite={canWrite}
            onRoomsChanged={reload}
          />
        )}

        {activeProject && (
          <>
            {user && (
              <StageExpensePanel
                userId={user.id}
                projectId={activeProject.id}
                project={activeProject}
                role={isContractor ? 'contractor' : 'customer'}
                stageId={stage.id}
                stageName={stage.name}
                roomIds={stage.room_ids}
                readOnly={!canWrite}
              />
            )}
            <StageEstimatePanel
              lines={activeProject.estimate_lines || []}
              rooms={activeProject.rooms || []}
              roomIds={stage.room_ids}
              estimateHref={objectTabHref(user?.role === 'contractor' ? 'contractor' : 'customer', 'estimate')}
            />
          </>
        )}

        {workSnap && (
          <View style={styles.card}>
            <Text style={styles.section}>Этап · {workSnap.percent_complete}%</Text>
            <Text style={styles.meta}>{workSnap.display_status_label || workSnap.status_label}{workSnap.room_name ? ` · ${workSnap.room_name}` : ''}</Text>
            <Text style={styles.meta}>Работ: {workSnap.works_done ?? workSnap.checklist_progress.done}/{workSnap.works_total ?? workSnap.checklist_progress.total} · материалы {workSnap.materials_count}{workSnap.overdue_days ? ` · +${workSnap.overdue_days} дн.` : ''}</Text>
            {workSnap.budget && <Text style={styles.meta}>Бюджет: {formatRub(workSnap.budget.planned)} · факт {formatRub(workSnap.budget.spent)}</Text>}
            <Text style={styles.meta}>Фото {workSnap.photos_count} · замечания {workSnap.issues_open}</Text>
            {!workSnap.completion.ok && workSnap.completion.failed.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.meta}>Перед сдачей:</Text>
                {workSnap.completion.failed.slice(0, 3).map((c) => (
                  <Text key={c.id} style={{ color: '#b45309', fontSize: 12 }}>• {c.message}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.status}>{STATUS[stage.status] || stage.status}</Text>
          <Text style={styles.meta}>Оплата: {formatRub(stage.payment_amount)}</Text>
          {stage.planned_start && <Text style={styles.meta}>План: {stage.planned_start} → {stage.planned_end}</Text>}
          {stage.contractor_ready && <Text style={styles.ok}>✓ Исполнитель отметил готовность</Text>}
        </View>

        {isContractor && stage.status === 'planned' && (
          <PrimaryButton disabled={!canWrite || blocked?.blocked} title={workSnap?.next_action?.button || "Начать этап"} onPress={async () => { try { await api.startStage(user!.id, activeProject.id, stage.id); await reload(); await loadProject(activeProject.id); } catch (e: unknown) { if (e instanceof ApiError && e.status === 409) Alert.alert('Блокировка', 'Сначала завершите зависимый этап'); else throw e; } }} />
        )}

        {isContractor && stage.status === 'active' && (
          <PrimaryButton disabled={!canWrite || (workSnap ? !workSnap.completion.ok : false)} title={workSnap?.next_action?.button || "Готово — на приёмку"} onPress={async () => { try { await submitStage(stage.id); await reload(); await loadProject(activeProject.id); } catch (e: unknown) { if (e instanceof Error && e.message === 'offline_queued') Alert.alert('Офлайн', 'Сдача отправится при подключении'); else if (e instanceof ApiError && e.status === 400) { const d = e.detail as { completion?: { failed?: { message: string }[] } } | undefined; Alert.alert('Не готово', (d?.completion?.failed || []).map((x) => x.message).join('\n') || e.message); } else throw e; } }} />
        )}

        {role === 'customer' && stage.status === 'review' && (
          <>
            <Text style={styles.section}>Чеклист приёмки</Text>
            {CHECKLIST.map((c) => {
              const wf = wfChecks.find((x) => x.text === c);
              const done = wf ? wf.done : !!checks[c];
              return (
              <Pressable key={c} style={styles.checkRow} onPress={async () => {
                if (wf && user && activeProject) {
                  await api.toggleStageChecklist(user.id, activeProject.id, stage.id, wf.id, !wf.done);
                  await reload();
                } else setChecks((x) => ({ ...x, [c]: !x[c] }));
              }}>
                <Text>{done ? '☑' : '☐'} {c}</Text>
              </Pressable>
            );})}
            <PrimaryButton title="Принять этап" disabled={acceptBlocked || !canWrite} onPress={onAcceptPress} />
            <PrimaryButton title="Вернуть на доработку" variant="dangerOutline" disabled={!canWrite} onPress={() => setRejectOpen(true)} />
            {role === 'customer' && (<><TextInput style={styles.input} placeholder="Свой пункт чеклиста…" value={newCheck} onChangeText={setNewCheck} /><PrimaryButton title="Добавить пункт" variant="outline" onPress={async () => { if(!id||!newCheck.trim()) return; setCustomChecks(await addCustomCheck(id, newCheck)); setNewCheck(''); }} /></>)}
            {acceptBlocked && <Text style={styles.meta}>Отметьте все пункты для приёмки</Text>}
            {!acceptBlocked && CHECKLIST.length === 0 && <Text style={styles.meta}>Чеклист пуст — при приёмке будет запрос подтверждения</Text>}
          </>
        )}

        <Text style={styles.section}>Комментарии</Text>
        {isContractor && (
          <View style={styles.tplRow}>
            {TEMPLATES.map((t) => (
              <Pressable key={t} style={styles.tpl} onPress={() => onAddComment(t)}><Text style={styles.tplT}>{t}</Text></Pressable>
            ))}
          </View>
        )}
        {stage.comments.map((c) => (
          <Pressable key={c.id} style={styles.comment} onPress={() => setReplyTo(c.text)}>
            <Text style={styles.commentRole}>{c.author_role === 'contractor' ? 'Исполнитель' : 'Заказчик'}</Text>
            <Text>{renderComment(c.text)}</Text>
            <CommentReactions id={c.id} stageId={stage.id} counts={reactCounts[c.id]} />
            <Text style={styles.meta}>{c.created_at.slice(0, 16).replace('T', ' ')}</Text>
          </Pressable>
        ))}
        {replyTo && <Text style={styles.meta}>Ответ на: {replyTo.slice(0,40)}… <Text onPress={() => setReplyTo(null)}>✕</Text></Text>}
        <TextInput editable={canWrite} style={styles.input} placeholder="Комментарий…" value={comment} onChangeText={setComment} multiline />
        {process.env.EXPO_PUBLIC_WHISPER_URL ? (
          <PrimaryButton title="Голосовой комментарий" variant="outline" onPress={async () => { const { recordVoiceStub } = await import("@/lib/voiceRecord"); const { transcribeAudio } = await import("@/lib/whisperStub"); onAddComment(await transcribeAudio(await recordVoiceStub())); }} />
        ) : null}
        <PrimaryButton disabled={!canWrite} title="Отправить" onPress={() => onAddComment()} />
        {role === 'customer' && stage.status === "review" && user && (
          <>
            <PrimaryButton title="Полноэкранное сравнение" variant="outline" onPress={() => setSwipeOpen(true)} />
            <PhotoSwipeCompare before={before} after={after} visible={swipeOpen} onClose={() => setSwipeOpen(false)} />
            <PrimaryButton title="Акт приёмки" variant="outline" onPress={() => { onExportAcceptance().catch(() => {}); }} />
          </>
        )}

        <PhotoCompare before={before} after={after} />
        <Text style={styles.section}>Фото до / после</Text>
        <View style={styles.photoBtns}>
          <PrimaryButton disabled={!canWrite} title="До работ" variant="outline" onPress={() => onAddPhoto('До работ')} />
          <PrimaryButton disabled={!canWrite} title="После работ" variant="outline" onPress={() => onAddPhoto('После работ')} />
        </View>
        {[{ title: 'До', list: before }, { title: 'После', list: after }, { title: 'Прочие', list: other }].map(({ title, list }) => list.length > 0 && (
          <View key={title}>
            <Text style={styles.subSection}>{title}</Text>
            {list.map((p) => (
              <View key={p.id} style={styles.photoRow}>
                {(p as any).image_url ? <Image source={{ uri: (p as any).image_url }} style={styles.img} /> : null}
                <Text>{p.caption || 'Фото'} · {p.created_at.slice(0, 10)}</Text>
              </View>
            ))}
          </View>
        ))}
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
            if (e instanceof Error && e.message === 'offline_queued') Alert.alert('Офлайн', 'Отклонение отправится при подключении');
            else Alert.alert('Ошибка', 'Не удалось вернуть этап на доработку');
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  archiveBanner: { ...card, backgroundColor: RenovaTheme.colors.surfaceMuted },
  archiveText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, fontWeight: RenovaTheme.fontWeight.semibold, marginBottom: 4 },
  linksTitle: { fontWeight: RenovaTheme.fontWeight.bold, marginBottom: 6 },
  link: { color: RenovaTheme.colors.accent, paddingVertical: 4, fontWeight: RenovaTheme.fontWeight.semibold },
  card: { ...card, padding: RenovaTheme.spacing.md },
  status: { fontSize: RenovaTheme.fontSize.h2, fontWeight: RenovaTheme.fontWeight.bold },
  meta: { color: RenovaTheme.colors.textMuted, marginTop: 4, fontSize: RenovaTheme.fontSize.bodySmall },
  ok: { color: RenovaTheme.colors.success, marginTop: 6, fontWeight: RenovaTheme.fontWeight.semibold },
  section: { fontWeight: RenovaTheme.fontWeight.bold, fontSize: RenovaTheme.fontSize.h3, marginTop: RenovaTheme.spacing.lg, marginBottom: RenovaTheme.spacing.sm },
  subSection: { fontWeight: RenovaTheme.fontWeight.semibold, marginTop: 10, marginBottom: 4 },
  comment: { ...card, padding: 10 },
  commentRole: { fontSize: RenovaTheme.fontSize.tiny, color: RenovaTheme.colors.textMuted, fontWeight: RenovaTheme.fontWeight.semibold },
  input: { ...inputField, minHeight: 60, marginVertical: RenovaTheme.spacing.sm },
  tplRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: RenovaTheme.spacing.sm },
  tpl: { backgroundColor: RenovaTheme.colors.infoBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RenovaTheme.radius.pill, borderWidth: 1, borderColor: RenovaTheme.colors.infoBorder },
  tplT: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.infoText },
  checkRow: { ...card, padding: 10, marginBottom: 6 },
  photoBtns: { flexDirection: 'row', gap: RenovaTheme.spacing.sm, marginBottom: RenovaTheme.spacing.sm },
  photoRow: { ...card, padding: 10, marginTop: RenovaTheme.spacing.sm },
  img: { width: '100%', height: 160, borderRadius: 8, marginBottom: 6 },
});