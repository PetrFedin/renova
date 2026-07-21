/** Верх экрана этапа: статус, главное действие, краткий прогресс */
import { View, Text, StyleSheet, Alert } from 'react-native';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { STAGE_STATUS_LABEL } from '@/constants/labels';
import { api, type StageDetail, type WorkSnapshot, ApiError } from '@/lib/api';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { alertStageStarted } from '@/lib/jobLeadNav';
import { alertStageSubmittedForAcceptance } from '@/lib/fieldCreateNav';

type Props = {
  stage: StageDetail;
  workSnap: WorkSnapshot | null;
  isContractor: boolean;
  canWrite: boolean;
  blocked: { blocked: boolean; depends_on?: string } | null;
  contractGate?: { ok: boolean; message?: string; pending_titles?: string[] } | null;
  userId: string;
  projectId: string;
  onReload: () => Promise<void>;
  onProjectReload: () => Promise<void>;
  onSubmitStage: (stageId: string) => Promise<void>;
};

export function StageDetailHero({
  stage,
  workSnap,
  isContractor,
  canWrite,
  blocked,
  contractGate,
  userId,
  projectId,
  onReload,
  onProjectReload,
  onSubmitStage,
}: Props) {
  const role: OsRole = isContractor ? 'contractor' : 'customer';
  const stageReturn = `/stage/${stage.id}`;
  const statusLabel = STAGE_STATUS_LABEL[stage.status] || stage.status;

  const openDocs = () => pushOsNav('/documents', stageReturn, role);

  return (
    <View style={s.box}>
      <Text style={s.status}>{statusLabel}</Text>
      {workSnap ? (
        <Text style={s.meta}>
          {workSnap.display_status_label || workSnap.status_label}
          {workSnap.room_name ? ` · ${workSnap.room_name}` : ''}
          {' · '}{workSnap.percent_complete}%
        </Text>
      ) : null}
      <Text style={s.meta}>К оплате: {formatRub(stage.payment_amount)}</Text>
      {stage.planned_start ? (
        <Text style={s.meta}>План: {stage.planned_start} → {stage.planned_end || '—'}</Text>
      ) : null}
      {stage.contractor_ready ? <Text style={s.ok}>Исполнитель отметил готовность</Text> : null}

      {workSnap && !workSnap.completion.ok && workSnap.completion.failed.length > 0 && isContractor ? (
        <View style={s.warnBox}>
          <Text style={s.warnHead}>Перед сдачей:</Text>
          {workSnap.completion.failed.slice(0, 3).map((c) => (
            <Text key={c.id} style={s.warnItem}>• {c.message}</Text>
          ))}
        </View>
      ) : null}

      {isContractor && stage.status === 'planned' && contractGate && !contractGate.ok ? (
        <View style={s.warnBox}>
          <Text style={s.warnHead}>Перед началом работ</Text>
          <Text style={s.warnItem}>{contractGate.message || 'Подпишите договор'}</Text>
          {(contractGate.pending_titles || []).slice(0, 2).map((title) => (
            <Text key={title} style={s.warnItem}>• {title}</Text>
          ))}
          <PrimaryButton
            title="К документам"
            variant="outline"
            compact
            onPress={openDocs}
          />
        </View>
      ) : null}

      {isContractor && stage.status === 'planned' ? (
        <PrimaryButton
          disabled={!canWrite || blocked?.blocked}
          title={workSnap?.next_action?.button || 'Начать этап'}
          onPress={async () => {
            try {
              await api.startStage(userId, projectId, stage.id);
              await onReload();
              await onProjectReload();
              await syncProjectSideEffects({
                user: { id: userId } as any,
                project: { id: projectId } as any,
              });
              // W130: старт этапа → график / работы
              alertStageStarted(role);
            } catch (e: unknown) {
              if (e instanceof Error && e.message === 'offline_queued') {
                Alert.alert('Офлайн', 'Старт этапа отправится при подключении');
              } else if (e instanceof ApiError && e.status === 409) {
                Alert.alert('Блокировка', 'Сначала завершите зависимый этап');
              } else if (e instanceof ApiError && e.status === 403) {
                const d = e.detail as { code?: string; message?: string; pending_titles?: string[] } | undefined;
                if (d?.code === 'contract_not_signed') {
                  const titles = (d.pending_titles || []).join(', ');
                  Alert.alert(
                    'Нужен договор',
                    [d.message || 'Подпишите договор перед началом работ', titles ? `Документы: ${titles}` : ''].filter(Boolean).join('\n'),
                    [
                      { text: 'Отмена', style: 'cancel' },
                      { text: 'К документам', onPress: openDocs },
                    ],
                  );
                } else {
                  Alert.alert('Доступ запрещён', d?.message || e.message);
                }
              } else throw e;
            }
          }}
        />
      ) : null}

      {isContractor && stage.status === 'active' ? (
        <PrimaryButton
          disabled={!canWrite || (workSnap ? !workSnap.completion.ok : false)}
          title={workSnap?.next_action?.button || 'Готово — на приёмку'}
          onPress={async () => {
            try {
              await onSubmitStage(stage.id);
              await onReload();
              await onProjectReload();
              // W133: сдача → приёмка / inbox
              alertStageSubmittedForAcceptance(role);
            } catch (e: unknown) {
              if (e instanceof Error && e.message === 'offline_queued') {
                Alert.alert('Офлайн', 'Сдача отправится при подключении');
              } else if (e instanceof ApiError && e.status === 400) {
                const d = e.detail as { completion?: { failed?: { message: string }[] } } | undefined;
                Alert.alert(
                  'Не готово',
                  (d?.completion?.failed || []).map((x) => x.message).join('\n') || e.message,
                );
              } else throw e;
            }
          }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { ...card, padding: RenovaTheme.spacing.md, gap: 4 },
  status: { fontSize: RenovaTheme.fontSize.h2, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  meta: { color: RenovaTheme.colors.textMuted, fontSize: RenovaTheme.fontSize.bodySmall, marginTop: 2 },
  ok: { color: RenovaTheme.colors.success, marginTop: 6, fontWeight: RenovaTheme.fontWeight.semibold },
  warnBox: { marginTop: 8, padding: 8, borderRadius: RenovaTheme.radius.sm, backgroundColor: RenovaTheme.colors.warningBg },
  warnHead: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.warningText },
  warnItem: { fontSize: 12, color: RenovaTheme.colors.warningText, marginTop: 2 },
});
