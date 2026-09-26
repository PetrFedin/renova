/**
 * Порядок оплаты по этапам — сколько из цены договора привязано к работам.
 *
 * Платёж по этапу создаётся только при `payment_amount > 0`. Пока суммы не
 * разнесены, этап принимается, акт создаётся, а денег не возникает — молча.
 * Здесь это видно числом и правится руками.
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { api } from '@/lib/api';
import type { StagePaymentPlan } from '@/lib/api';
import { reportError } from '@/lib/reportError';
import { apiErrorMessage } from '@/lib/formatPhone';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { parseAmountInput, undistributedNote } from '@/lib/domain/stagePaymentPlan';

export function StagePaymentPlanPanel({
  userId,
  projectId,
  canEdit,
}: {
  userId: string;
  projectId: string;
  canEdit: boolean;
}) {
  const [plan, setPlan] = useState<StagePaymentPlan | null>(null);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api
      .getStagePaymentPlan(userId, projectId)
      .then((next) => {
        setPlan(next);
        setFailed(false);
        setDrafts(
          Object.fromEntries(next.stages.map((stage) => [stage.id, String(stage.payment_amount)])),
        );
      })
      .catch((error: unknown) => {
        // Пустой список читался бы как «этапов нет»; это неправда.
        setFailed(true);
        reportError('StagePaymentPlanPanel.load', error, { projectId });
      });
  }, [userId, projectId]);

  useEffect(() => { load(); }, [load]);

  if (failed) {
    return (
      <View style={s.box}>
        <Text style={s.head}>Порядок оплаты</Text>
        <Text style={s.warn}>Не удалось загрузить. Это не значит, что оплат нет.</Text>
        <PrimaryButton title="Повторить" variant="outline" compact onPress={load} />
      </View>
    );
  }
  if (!plan) return null;

  const parsed = plan.stages.map((stage) => parseAmountInput(drafts[stage.id] ?? ''));
  const invalid = parsed.some((value) => value === null);
  const draftSum = parsed.reduce((sum: number, value) => sum + (value ?? 0), 0);
  const draftLeft = Math.round((plan.total - draftSum) * 100) / 100;
  const note = undistributedNote({ undistributed: draftLeft });

  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    try {
      const amounts: Record<string, number> = {};
      plan.stages.forEach((stage, index) => { amounts[stage.id] = parsed[index] ?? 0; });
      const next = await api.updateStagePaymentPlan(userId, projectId, amounts);
      setPlan(next);
      setDrafts(
        Object.fromEntries(next.stages.map((stage) => [stage.id, String(stage.payment_amount)])),
      );
    } catch (error: unknown) {
      // Молчаливый провал здесь означал бы, что человек считает суммы
      // сохранёнными, а платежей всё равно не возникнет.
      reportError('StagePaymentPlanPanel.save', error, { projectId });
      showActionConfirm({
        title: 'Не удалось сохранить порядок оплаты',
        message: apiErrorMessage(error, 'Проверьте связь и повторите'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={s.box}>
      <Text style={s.head}>Порядок оплаты по этапам</Text>
      <Text style={s.sub}>
        Цена договора {formatRub(plan.total)} · разнесено {formatRub(draftSum)}
      </Text>
      {note ? <Text style={s.warn}>{note}</Text> : <Text style={s.ok}>Сходится с ценой договора</Text>}

      {plan.stages.map((stage, index) => (
        <View key={stage.id} style={s.row}>
          <Text style={s.name} numberOfLines={1}>{stage.name}</Text>
          {canEdit ? (
            <TextInput
              style={[s.input, parsed[index] === null && s.inputBad]}
              value={drafts[stage.id] ?? ''}
              onChangeText={(text) => setDrafts((prev) => ({ ...prev, [stage.id]: text }))}
              keyboardType="decimal-pad"
              accessibilityLabel={`Сумма по этапу: ${stage.name}`}
              editable={!saving}
            />
          ) : (
            <Text style={s.amount}>{formatRub(stage.payment_amount)}</Text>
          )}
        </View>
      ))}

      {canEdit ? (
        <PrimaryButton
          title={saving ? 'Сохранение…' : 'Сохранить распределение'}
          variant="outline"
          disabled={invalid || saving}
          onPress={() => { void save(); }}
        />
      ) : null}
      {invalid ? <Text style={s.warn}>Сумма должна быть числом не меньше нуля</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { ...card, padding: RenovaTheme.spacing.md, marginTop: RenovaTheme.spacing.md, gap: 6 },
  head: { ...screenTypography.section, marginTop: 0, marginBottom: 0 },
  sub: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  ok: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.success },
  warn: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.danger },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 4,
  },
  name: { flex: 1, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.text },
  amount: { fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: '700', color: RenovaTheme.colors.text },
  input: {
    minWidth: 110,
    minHeight: RenovaTheme.minTouch,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.sm,
    paddingHorizontal: 10,
    textAlign: 'right',
    color: RenovaTheme.colors.text,
  },
  inputBad: { borderColor: RenovaTheme.colors.danger },
});
