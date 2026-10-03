/** Верх экрана этапа: статус, главное действие, краткий прогресс */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { STAGE_STATUS_LABEL } from '@/constants/labels';
import { api, type StageDetail, type WorkSnapshot, ApiError } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { alertStageStarted } from '@/lib/jobLeadNav';
import { submitStageWithFeedback } from '@/lib/submitStageUi';
import { acceptanceActions, stageStatusText, latestReturnedAcceptance } from '@/lib/domain/acceptanceActions';
import { useEffect, useState } from 'react';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { apiErrorMessage } from '@/lib/formatPhone';
import { StageContextSummary } from '@/components/screens/stage/StageContextSummary';
import { ReworkExtensionRequestCard } from '@/components/screens/stage/ReworkExtensionRequestCard';
import { formatScheduleDayFull } from '@/lib/formatScheduleDate';

type Props = {
  stage: StageDetail;
  workSnap: WorkSnapshot | null;
  isContractor: boolean;
  canWrite: boolean;
  blocked: { blocked: boolean; depends_on?: string } | null;
  contractGate?: { ok: boolean; reason?: string; message?: string; pending_titles?: string[] } | null;
  /** После создания договора экран перечитывает гейт. */
  onContractCreated?: () => void;
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
  onContractCreated,
  userId,
  projectId,
  onReload,
  onProjectReload,
  onSubmitStage,
}: Props) {
  const role: OsRole = isContractor ? 'contractor' : 'customer';
  const stageReturn = `/stage/${stage.id}`;
  const statusLabel = stageStatusText(stage, STAGE_STATUS_LABEL);
  const acts = acceptanceActions({
    role,
    stageStatus: stage.status,
    needsRework: stage.needs_rework,
    canSubmit: stage.capabilities ? stage.capabilities.can_submit_for_review === true : undefined,
    canReview: stage.capabilities ? stage.capabilities.can_review : undefined,
  });
  const reworkReason = useReworkReason(stage, userId, projectId);
  // Server capability is the sole source of truth for mutation affordances.
  // A legacy/stale cached StageDetail without capabilities intentionally hides writes.
  const canStart = stage.capabilities?.can_start === true;
  const canSubmit = stage.capabilities?.can_submit_for_review === true;
  const hasPrimaryFlowAction = canStart || canSubmit || (!isContractor && stage.status === 'review');

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
      {stage.planned_start ? (
        <Text style={s.meta}>План: {formatScheduleDayFull(stage.planned_start)} → {formatScheduleDayFull(stage.planned_end)}</Text>
      ) : null}
      {stage.contractor_ready && stage.status !== 'active' ? <Text style={s.ok}>Исполнитель отметил готовность</Text> : null}
      {isContractor && stage.status === 'review' && acts.statusText ? <Text style={s.meta}>{acts.statusText}</Text> : null}

      {stage.status === 'active' && stage.needs_rework ? (
        <View style={s.warnBox}>
          <Text style={s.warnHead}>{isContractor ? 'Заказчик вернул этап на доработку' : 'Этап возвращён исполнителю на доработку'}</Text>
          <Text style={s.warnItem}>Причина: {reworkReason || 'не указана — уточните в комментариях'}</Text>
          {stage.rework_deadline ? <Text style={s.warnItem}>Срок доработки: {formatScheduleDayFull(stage.rework_deadline)}</Text> : null}
        </View>
      ) : null}

      <ReworkExtensionRequestCard
        stage={stage}
        isContractor={isContractor}
        canWrite={canWrite}
        userId={userId}
        projectId={projectId}
        onChanged={async () => { await onReload(); await onProjectReload(); }}
      />

      <StageContextSummary
        stage={stage}
        role={role}
        returnTo={stageReturn}
        showAction={!hasPrimaryFlowAction}
      />

      {workSnap && !workSnap.completion.ok && workSnap.completion.failed.length > 0 && canSubmit ? (
        <View style={s.warnBox}>
          <Text style={s.warnHead}>Перед сдачей:</Text>
          {workSnap.completion.failed.map((c) => (
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
          {contractGate.reason === 'no_contract' ? (
            <PrimaryButton
              title="Создать договор"
              variant="accent"
              compact
              disabled={!canWrite}
              onPress={async () => {
                try {
                  await api.createProjectContract(userId, projectId);
                  onContractCreated?.();
                  openDocs();
                } catch (e: unknown) {
                  showActionConfirm({
                    title: 'Договор не создан',
                    message: apiErrorMessage(e, 'Сначала заполните и зафиксируйте смету'),
                    primaryLabel: 'Понятно',
                    onPrimary: () => undefined,
                  });
                }
              }}
            />
          ) : (
            <PrimaryButton
              title="К документам"
              variant="outline"
              compact
              onPress={openDocs}
            />
          )}
        </View>
      ) : null}

      {canStart ? (
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
              alertStageStarted(role);
            } catch (e: unknown) {
              if (isOfflineQueued(e)) {
                notifyOfflineQueued('Старт этапа');
              } else if (e instanceof ApiError && e.status === 409) {
                const code = (e.detail as { code?: string } | undefined)?.code;
                showActionConfirm({
                  title: code === 'stage_start_invalid_status' ? 'Этап уже в работе' : 'Блокировка',
                  message: code === 'stage_start_invalid_status' ? 'Статус этапа изменился — обновите экран.' : 'Сначала завершите зависимый этап',
                  primaryLabel: 'Понятно',
                  onPrimary: () => undefined,
                });
              } else if (e instanceof ApiError && e.status === 403) {
                const d = e.detail as { code?: string; message?: string; pending_titles?: string[] } | undefined;
                if (d?.code === 'contract_not_signed') {
                  const titles = (d.pending_titles || []).join(', ');
                  showActionConfirm({
                    title: 'Нужен договор',
                    message: [d.message || 'Подпишите договор перед началом работ', titles ? `Документы: ${titles}` : ''].filter(Boolean).join('\n'),
                    primaryLabel: 'К документам',
                    onPrimary: openDocs,
                    secondaryLabel: 'Позже',
                    onSecondary: () => undefined,
                  });
                } else {
                  showActionConfirm({
                    title: 'Доступ запрещён',
                    message: d?.message || e.message,
                    primaryLabel: 'Понятно',
                    onPrimary: () => undefined,
                  });
                }
              } else throw e;
            }
          }}
        />
      ) : null}

      {canSubmit ? (
        <PrimaryButton
          variant="accent"
          disabled={!canWrite || (workSnap ? !workSnap.completion.ok : false)}
          title={stage.needs_rework ? 'Сдать повторно' : workSnap?.next_action?.button || 'Готово — на приёмку'}
          onPress={() => {
            void submitStageWithFeedback({
              submit: () => onSubmitStage(stage.id),
              role,
              onSubmitted: async () => { await onReload(); await onProjectReload(); },
            });
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

/** Причина последнего возврата — из записи приёмки (comment) со статусом returned. */
function useReworkReason(stage: StageDetail, userId: string, projectId: string): string | null {
  const [reason, setReason] = useState<string | null>(null);
  const active = stage.status === 'active' && stage.needs_rework === true;
  useEffect(() => {
    if (!active) { setReason(null); return; }
    let live = true;
    api.listWorkAcceptances(userId, projectId, stage.id)
      .then((rows) => { if (live) setReason(latestReturnedAcceptance(rows, stage.id)?.comment?.trim() || null); })
      .catch(() => { if (live) setReason(null); });
    return () => { live = false; };
  }, [active, stage.id, userId, projectId]);
  return reason;
}
