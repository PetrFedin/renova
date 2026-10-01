/** Единый список приёмки — Clarity D: поверхность «Решение» (accept/return SoT) */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { notifyError } from '@/lib/notify';
import { pushStageDetail } from '@/lib/navigation';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { AcceptanceDecisionButtons } from '@/components/renova/AcceptanceDecisionButtons';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { buildUnifiedAcceptanceItems, type UnifiedAcceptanceItem } from '@/lib/domain/acceptancePending';
import { api, type Stage, type WorkAcceptance } from '@/lib/api';
import { acceptanceDecisionBody } from '@/lib/acceptanceDecide';
import { repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { useRenova } from '@/lib/context/RenovaContext';
import { alertStageAccepted } from '@/lib/acceptanceNav';
import { reportCatch } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { ActionConfirmSheet } from '@/components/renova/ActionConfirmSheet';
import { buildReworkItems, effectiveAcceptanceRole, type ReworkItem } from '@/lib/domain/acceptanceActions';
import { submitStageWithFeedback } from '@/lib/submitStageUi';

export function UnifiedAcceptanceList({
  stages,
  acceptances,
  returnTo,
  role = 'customer',
  onChanged,
}: {
  stages: Stage[] | undefined;
  acceptances: WorkAcceptance[];
  returnTo?: string;
  role?: 'customer' | 'contractor';
  /** После accept/return — обновить parent (список acceptances) */
  onChanged?: () => void;
}) {
  const { user, activeProject, submitStage } = useRenova();
  const items = buildUnifiedAcceptanceItems(stages, acceptances);
  // UI-010: исполнитель никогда не видит кнопки заказчика, что бы ни передал родитель
  const effectiveRole = effectiveAcceptanceRole(user?.role, role);
  const isContractor = effectiveRole === 'contractor';
  const reworkItems = isContractor ? buildReworkItems(stages, acceptances) : [];
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Clarity D: sheet вместо Alert после возврата */
  const [returnSheet, setReturnSheet] = useState<{ stageId: string } | null>(null);

  const projectId = activeProject?.id;
  const userId = user?.id;

  const decide = async (
    item: UnifiedAcceptanceItem,
    action: 'accept' | 'return',
    opts: { qualityScore: number | null; reason?: string },
  ): Promise<boolean> => {
    if (!userId || !projectId) return false;
    let ok = true;
    setBusyId(item.id);
    try {
      if (action === 'accept') {
        if (item.kind !== 'acceptance') {
          pushStageDetail(item.stageId, returnTo);
          return false;
        }
        await api.acceptWork(
          userId,
          projectId,
          item.acceptanceId,
          {
            ...acceptanceDecisionBody({ qualityScore: opts.qualityScore, comment: 'Работы приняты' }),
            mode: 'inline',
          },
        );
        await syncProjectSideEffects({ user, project: activeProject });
        onChanged?.();
        // W125: оплата / план с ✓ pin (единый SoT с карточкой этапа)
        alertStageAccepted(role);
      } else {
        const reason = opts.reason?.trim();
        if (!reason) return false; // причина возврата обязательна (проверяет и RejectStageModal)
        if (item.kind === 'acceptance') {
          await api.returnWork(
            userId,
            projectId,
            item.acceptanceId,
            acceptanceDecisionBody({ qualityScore: opts.qualityScore, comment: reason, createIssue: true }),
          );
        } else {
          // сирота: этап в review без записи приёмки — канонический возврат этапа
          await api.rejectStage(userId, projectId, item.stageId, reason, { qualityScore: opts.qualityScore });
        }
        await syncProjectSideEffects({ user, project: activeProject });
        onChanged?.();
        setReturnSheet({ stageId: item.stageId });
      }
    } catch (e: unknown) {
      if (isOfflineQueued(e)) notifyOfflineQueued(action === 'accept' ? 'Приёмка' : 'Возврат');
      else {
        ok = false;
        const code = (e as { code?: string })?.code;
        if (action === 'accept' && (code === 'checklist_required' || code === 'checklist_incomplete')) {
          showActionConfirm({
            title: 'Нужен чек-лист',
            message: 'Откройте этап и отметьте пункты перед приёмкой.',
            primaryLabel: 'К этапу',
            onPrimary: () => pushStageDetail(item.stageId, returnTo),
            secondaryLabel: 'Позже',
            onSecondary: () => undefined,
          });
        } else {
          notifyError('Ошибка', e, 'Не удалось выполнить действие');
        }
      }
    } finally {
      setBusyId(null);
    }
    return ok;
  };

  const resubmit = (item: ReworkItem) => {
    void submitStageWithFeedback({
      submit: () => submitStage(item.stageId),
      role: 'contractor',
      onSubmitted: async () => { onChanged?.(); },
      onOpenStage: () => pushStageDetail(item.stageId, returnTo),
    });
  };

  if (!items.length && !reworkItems.length) {
    return (
      <EmptyActionState
        title={isContractor ? 'Нет этапов на приёмке' : 'Сейчас ничего не ждёт решения'}
        hint={isContractor ? 'Когда сдадите этап — статус появится здесь. Вернут на доработку — причина и срок тоже.' : 'Когда исполнитель сдаст этап — решите здесь.'}
        icon="checkmark-done-outline"
        actionLabel="Открыть этапы"
        actionVariant="accent"
        onAction={() => pushOsNav(repairTabRoute(role, 'works', 'review'), returnTo)}
      />
    );
  }

  return (
    <>
      {reworkItems.map((r) => (
        <ReworkRow key={`rw-${r.stageId}`} item={r} onOpen={() => pushStageDetail(r.stageId, returnTo)} onResubmit={() => resubmit(r)} />
      ))}
      {items.length ? (
        <Text style={s.hint}>
          {isContractor
            ? `${items.length} у заказчика — откройте этап или дождитесь решения.`
            : `${items.length} ждут решения — примите или верните (причина обязательна).`}
        </Text>
      ) : null}
      {items.map((it) => (
        <AcceptanceRow
          key={it.id}
          item={it}
          isContractor={isContractor}
          busy={busyId === it.id}
          onOpen={() => pushStageDetail(it.stageId, returnTo)}
          onAccept={(qualityScore) => {
            // Clarity U: pre-confirm (portal return уже sheet; accept был one-tap)
            showActionConfirm({
              title: 'Принять этап?',
              message: `«${it.title}». После приёмки откроется цепочка оплаты.`,
              primaryLabel: 'Принять',
              onPrimary: () => {
                decide(it, 'accept', { qualityScore }).catch(reportCatch('acceptance.accept'));
              },
              secondaryLabel: 'Отмена',
              onSecondary: () => undefined,
            });
          }}
          onReturn={(reason, qualityScore) =>
            decide(it, 'return', { qualityScore, reason }).catch((e) => {
              reportCatch('acceptance.return')(e);
              return false;
            })
          }
        />
      ))}
      <ActionConfirmSheet
        visible={Boolean(returnSheet)}
        title="На доработку"
        message="Исполнитель увидит причину и срок доработки и сдаст этап повторно."
        primaryLabel="К этапу"
        onPrimary={() => {
          if (returnSheet) pushStageDetail(returnSheet.stageId, returnTo);
        }}
        secondaryLabel="Закрыть"
        onSecondary={() => undefined}
        onClose={() => setReturnSheet(null)}
      />
    </>
  );
}

function AcceptanceRow({
  item,
  onOpen,
  onAccept,
  onReturn,
  isContractor,
  busy,
}: {
  item: UnifiedAcceptanceItem;
  onOpen: () => void;
  onAccept: (qualityScore: number | null) => void;
  onReturn: (reason: string, qualityScore: number | null) => Promise<boolean>;
  isContractor: boolean;
  busy: boolean;
}) {
  const orphan = item.kind !== 'acceptance';
  return (
    <View style={s.rowCard}>
      <View style={s.rowTop}>
        <Pressable onPress={onOpen} style={{ flex: 1 }}>
          <Text style={s.title}>{item.title}</Text>
          <Text style={s.meta}>
            {item.sub}
            {isContractor ? ' · ждёт решения заказчика' : orphan ? ' · запрос на приёмку не найден' : ' · ждёт вашего решения'}
          </Text>
        </Pressable>
        <PrimaryButton title="Открыть этап" compact variant="outline" onPress={onOpen} />
      </View>
      {!isContractor ? (
        <AcceptanceDecisionButtons
          stageName={item.title}
          compact
          inline
          busy={busy}
          showScore={!orphan}
          acceptDisabled={orphan}
          onAccept={onAccept}
          onReturn={onReturn}
        />
      ) : null}
    </View>
  );
}

/** Исполнитель: этап вернули — причина, срок и «Сдать повторно». */
function ReworkRow({ item, onOpen, onResubmit }: { item: ReworkItem; onOpen: () => void; onResubmit: () => void }) {
  return (
    <View style={s.rowCard}>
      <Pressable onPress={onOpen}>
        <Text style={s.title}>{item.title}</Text>
        <Text style={s.meta}>Возвращено на доработку</Text>
        <Text style={s.meta}>Причина: {item.reason || 'не указана — уточните в комментариях этапа'}</Text>
        {item.deadline ? <Text style={s.meta}>Срок доработки: {item.deadline}</Text> : null}
      </Pressable>
      <View style={s.btnRow}>
        <PrimaryButton title="Сдать повторно" variant="accent" compact onPress={onResubmit} />
        <PrimaryButton title="Открыть этап" variant="outline" compact onPress={onOpen} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  hint: { ...screenTypography.listMeta, marginBottom: 10 },
  rowCard: {
    ...listRowStyles.row,
    gap: 8,
    paddingBottom: 14,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...screenTypography.listTitle },
  meta: { ...screenTypography.listMeta },
  actions: { gap: 8 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
