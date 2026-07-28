/** Единый список приёмки — Clarity D: поверхность «Решение» (accept/return SoT) */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { pushStageDetail } from '@/lib/navigation';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { QualityScorePicker } from '@/components/renova/QualityScorePicker';
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
  const { user, activeProject } = useRenova();
  const items = buildUnifiedAcceptanceItems(stages, acceptances);
  const isContractor = role === 'contractor';
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Оценка только по явному выбору пользователя (не 10/5 по умолчанию) */
  const [scores, setScores] = useState<Record<string, number | null>>({});
  /** Clarity D: sheet вместо Alert после возврата */
  const [returnSheet, setReturnSheet] = useState<{ stageId: string } | null>(null);

  const projectId = activeProject?.id;
  const userId = user?.id;

  const decide = async (item: UnifiedAcceptanceItem, action: 'accept' | 'return') => {
    if (!userId || !projectId) return;
    if (item.kind !== 'acceptance') {
      // Нет WorkAcceptance — открыть этап для чеклиста/решения
      pushStageDetail(item.stageId, returnTo);
      return;
    }
    setBusyId(item.id);
    try {
      const qualityScore = scores[item.id] ?? null;
      if (action === 'accept') {
        await api.acceptWork(
          userId,
          projectId,
          item.acceptanceId,
          {
            ...acceptanceDecisionBody({ qualityScore, comment: 'Работы приняты' }),
            mode: 'inline',
          },
        );
        await syncProjectSideEffects({ user, project: activeProject });
        onChanged?.();
        // W125: оплата / план с ✓ pin (единый SoT с карточкой этапа)
        alertStageAccepted(role);
      } else {
        await api.returnWork(
          userId,
          projectId,
          item.acceptanceId,
          acceptanceDecisionBody({
            qualityScore,
            comment: 'Нужна доработка',
            createIssue: true,
          }),
        );
        await syncProjectSideEffects({ user, project: activeProject });
        onChanged?.();
        setReturnSheet({ stageId: item.stageId });
      }
    } catch (e: unknown) {
      if (isOfflineQueued(e)) notifyOfflineQueued(action === 'accept' ? 'Приёмка' : 'Возврат');
      else {
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
          Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось выполнить действие');
        }
      }
    } finally {
      setBusyId(null);
    }
  };

  if (!items.length) {
    return (
      <EmptyActionState
        title={isContractor ? 'Нет этапов на приёмке' : 'Сейчас ничего не ждёт решения'}
        hint={isContractor ? 'Когда сдадите этап — статус появится здесь.' : 'Когда исполнитель сдаст этап — решите здесь.'}
        actionLabel="Открыть этапы"
        onAction={() => pushOsNav(repairTabRoute(role, 'works', 'review'), returnTo)}
      />
    );
  }

  return (
    <>
      <Text style={s.hint}>
        {isContractor
          ? `${items.length} у заказчика — откройте этап или дождитесь решения.`
          : `${items.length} ждут решения — примите или верните.`}
      </Text>
      {items.map((it) => (
        <AcceptanceRow
          key={it.id}
          item={it}
          isContractor={isContractor}
          busy={busyId === it.id}
          qualityScore={scores[it.id] ?? null}
          onScoreChange={(v) => setScores((prev) => ({ ...prev, [it.id]: v }))}
          onOpen={() => pushStageDetail(it.stageId, returnTo)}
          onAccept={() => {
            // Clarity U: pre-confirm (portal return уже sheet; accept был one-tap)
            showActionConfirm({
              title: 'Принять этап?',
              message: `«${it.title}». После приёмки откроется цепочка оплаты.`,
              primaryLabel: 'Принять',
              onPrimary: () => {
                decide(it, 'accept').catch(reportCatch('acceptance.accept'));
              },
              secondaryLabel: 'Отмена',
              onSecondary: () => undefined,
            });
          }}
          onReturn={() => {
            showActionConfirm({
              title: 'Вернуть на доработку?',
              message: `«${it.title}» вернётся исполнителю с задачей на правку.`,
              primaryLabel: 'Вернуть',
              onPrimary: () => {
                decide(it, 'return').catch(reportCatch('acceptance.return'));
              },
              secondaryLabel: 'Отмена',
              onSecondary: () => undefined,
            });
          }}
        />
      ))}
      <ActionConfirmSheet
        visible={Boolean(returnSheet)}
        title="На доработку"
        message="Исполнитель получил задачу на правку."
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
  qualityScore,
  onScoreChange,
}: {
  item: UnifiedAcceptanceItem;
  onOpen: () => void;
  onAccept: () => void;
  onReturn: () => void;
  isContractor: boolean;
  busy: boolean;
  qualityScore: number | null;
  onScoreChange: (v: number | null) => void;
}) {
  return (
    <View style={s.rowCard}>
      <View style={s.rowTop}>
        <Pressable onPress={onOpen} style={{ flex: 1 }}>
          <Text style={s.title}>{item.title}</Text>
          <Text style={s.meta}>
            {item.sub}
            {item.kind === 'acceptance' ? (isContractor ? ' · у заказчика' : ' · решение') : ' · откройте этап'}
          </Text>
        </Pressable>
        {isContractor ? <PrimaryButton title="Открыть этап" compact onPress={onOpen} /> : null}
      </View>
      {!isContractor ? (
        <View style={s.actions}>
          {item.kind === 'acceptance' ? (
            <QualityScorePicker value={qualityScore} onChange={onScoreChange} />
          ) : null}
          <View style={s.btnRow}>
            <PrimaryButton
              title="Принять"
              compact
              disabled={busy || item.kind !== 'acceptance'}
              onPress={item.kind === 'acceptance' ? onAccept : onOpen}
            />
            <PrimaryButton
              title="Вернуть"
              compact
              variant="outline"
              disabled={busy}
              onPress={item.kind === 'acceptance' ? onReturn : onOpen}
            />
            <PrimaryButton title="Этап" compact variant="ghost" onPress={onOpen} />
          </View>
        </View>
      ) : null}
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
