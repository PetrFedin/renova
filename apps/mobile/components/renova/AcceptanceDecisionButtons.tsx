/**
 * Канонический блок решения заказчика: «Принять» и «Вернуть на доработку» с обязательной
 * причиной (STG-004). Используется во вкладке «Ремонт → Приёмка» и на карточке этапа —
 * один компонент вместо разных кнопок и модалок. Исполнителю не показывается (UI-010):
 * вызывающий код решает по acceptanceActions().
 */
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { QualityScorePicker } from '@/components/renova/QualityScorePicker';
import { RejectStageModal } from '@/components/renova/RejectStageModal';

type Props = {
  stageName: string;
  /** qualityScore: null = без оценки (не подставляем 10/5) */
  onAccept: (qualityScore: number | null) => void;
  onReturn: (reason: string, qualityScore: number | null) => void;
  acceptDisabled?: boolean;
  returnDisabled?: boolean;
  busy?: boolean;
  /** Шкала оценки 1–10; в компактных строках списка скрыта */
  showScore?: boolean;
  compact?: boolean;
  /** Кнопки в одну строку (список) или столбиком (карточка этапа) */
  inline?: boolean;
};

export function AcceptanceDecisionButtons({
  stageName,
  onAccept,
  onReturn,
  acceptDisabled,
  returnDisabled,
  busy,
  showScore = true,
  compact,
  inline,
}: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  return (
    <View style={s.wrap}>
      {showScore ? <QualityScorePicker value={score} onChange={setScore} /> : null}
      <View style={inline ? s.row : s.col}>
        <PrimaryButton
          title="Принять"
          variant="accent"
          compact={compact}
          loading={busy}
          disabled={busy || acceptDisabled}
          onPress={() => onAccept(score)}
        />
        <PrimaryButton
          title="Вернуть на доработку"
          variant="dangerOutline"
          compact={compact}
          disabled={busy || returnDisabled}
          onPress={() => setReturnOpen(true)}
        />
      </View>
      <RejectStageModal
        visible={returnOpen}
        stageName={stageName}
        onClose={() => setReturnOpen(false)}
        onConfirm={(reason) => {
          setReturnOpen(false);
          onReturn(reason, score);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  col: { gap: 8 },
});
