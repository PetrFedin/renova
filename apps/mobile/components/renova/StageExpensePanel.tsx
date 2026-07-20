/** Расходы этапа: чеки + материалы + ручные — единый список без дублей */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router, usePathname } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { ExpenseDetailSheet, type ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { api, type MaterialPick, type OsExpense, type ProjectDetail, type Purchase, type ReceiptItem } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { buildUnifiedBudgetExpenses } from '@/lib/domain/buildUnifiedBudgetExpenses';
import { openExpenseRowTarget } from '@/lib/expenseRowNav';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';

function filterStageRows(rows: ExpenseDetailRow[], stageId: string, roomIds?: string[]): ExpenseDetailRow[] {
  const rooms = new Set(roomIds || []);
  return rows.filter((row) => {
    if (row.stageId === stageId) return true;
    if (!row.stageId && row.roomId && rooms.has(row.roomId)) return true;
    return false;
  });
}

export function StageExpensePanel({
  userId, projectId, project, role, stageId, stageName, roomIds, readOnly,
}: {
  userId: string;
  projectId: string;
  project?: ProjectDetail;
  role: OsRole;
  stageId: string;
  stageName?: string;
  roomIds?: string[];
  readOnly?: boolean;
}) {
  const pathname = usePathname();
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [expenses, setExpenses] = useState<OsExpense[]>([]);
  const [picks, setPicks] = useState<MaterialPick[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [detailTarget, setDetailTarget] = useState<ExpenseDetailTarget | null>(null);
  const initialRoomId = roomIds?.[0] ?? null;

  const reload = useCallback(() => {
    Promise.all([
      api.listReceipts(userId, projectId).catch(() => [] as ReceiptItem[]),
      api.osExpenses(userId, projectId).catch(() => [] as OsExpense[]),
      api.listMaterialPicks(userId, projectId).catch(() => [] as MaterialPick[]),
      api.listPurchases(userId, projectId).catch(() => [] as Purchase[]),
    ]).then(([rc, ex, pk, pur]) => {
      setReceipts(rc);
      setExpenses(ex);
      setPicks(pk);
      setPurchases(pur);
    });
  }, [userId, projectId]);

  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  const rooms = project?.rooms || [];
  const stages = project?.stages || [];
  const allRows = buildUnifiedBudgetExpenses(receipts, expenses, rooms, stages, picks, purchases);
  const rows = useMemo(() => filterStageRows(allRows, stageId, roomIds), [allRows, stageId, roomIds?.join(',')]);
  const stagePicks = useMemo(
    () => picks.filter((p) => p.stage_id === stageId || (!p.stage_id && p.room_id && roomIds?.includes(p.room_id))),
    [picks, stageId, roomIds?.join(',')],
  );
  const sum = rows.reduce((a, r) => a + r.amount, 0);

  const onRowPress = (row: ExpenseDetailRow) => {
    openExpenseRowTarget(row, receipts, expenses, picks, { returnTo: pathname, onDetail: setDetailTarget });
  };

  if (!rows.length && !stagePicks.length && readOnly) return null;

  return (
    <>
      <View style={s.box}>
        <Text style={s.head}>{stageName ? `${stageName} · ` : ''}Траты этапа · {formatRub(sum)}</Text>
        <Text style={s.hintTop}>Чеки, материалы и ручные расходы по этапу и его комнатам — без двойного учёта.</Text>
        {rows.length === 0 ? (
          <Text style={s.empty}>Пока нет учтённых трат по этому этапу.</Text>
        ) : (
          rows.map((row) => (
            <Pressable key={row.id} style={s.row} onPress={() => onRowPress(row)}>
              <Text style={s.amt}>{formatRub(row.amount)}</Text>
              <Text style={s.meta}>
                {row.categoryLabel}
                {row.roomName ? ` · ${row.roomName}` : ''}
                {row.kind === 'material' ? ' · подбор' : row.hasDocument ? ' · чек' : ''}
                {row.title ? ` · ${row.title.slice(0, 36)}` : ''}
              </Text>
            </Pressable>
          ))
        )}
        {stagePicks.length > 0 && (
          <View style={s.picksBlock}>
            <Text style={s.picksHead}>Материалы ({stagePicks.length})</Text>
            {stagePicks.slice(0, 5).map((p) => (
              <Pressable
                key={p.id}
                style={s.row}
                onPress={() => router.push({ pathname: '/material/[id]', params: { id: p.id, returnTo: pathname } } as any)}
              >
                <Text style={s.amt}>{formatRub(p.total || p.qty * p.price)}</Text>
                <Text style={s.meta}>{p.name} · {p.status}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {!readOnly && (
          <View style={{ gap: 4, marginTop: 8 }}>
            <Pressable onPress={() => pushOsNav(budgetTabRoute(role, 'expenses', { roomId: initialRoomId ?? undefined, stageId }), pathname)}>
              <Text style={s.link}>→ Добавить расход · Бюджет</Text>
            </Pressable>
            <Text style={s.hint}>Скан чека — кнопка + внизу экрана</Text>
          </View>
        )}
      </View>
      <ExpenseDetailSheet
        target={detailTarget}
        project={project}
        rooms={rooms}
        stages={stages}
        userId={userId}
        projectId={projectId}
        editable={!readOnly}
        onClose={() => setDetailTarget(null)}
        onChanged={reload}
      />
    </>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
  head: { fontWeight: '800', marginBottom: 4 },
  hintTop: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 15 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, fontStyle: 'italic' },
  row: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  amt: { fontWeight: '700' },
  meta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  picksBlock: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border },
  picksHead: { fontWeight: '700', fontSize: 12, marginBottom: 4, color: RenovaTheme.colors.textMuted },
  link: { fontSize: 13, color: RenovaTheme.colors.primary, fontWeight: '700', paddingVertical: 4 },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, fontStyle: 'italic' },
});
