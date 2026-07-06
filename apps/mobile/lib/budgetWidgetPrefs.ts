import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BUDGET_WIDGET_CATALOG,
  BUDGET_WIDGET_DEFAULT,
  type BudgetWidgetId,
  type BudgetWidgetRole,
} from '@/constants/budgetWidgets';

const key = (role: BudgetWidgetRole) => `renova_budget_widgets_${role}`;
const listeners = new Set<() => void>();

export function subscribeBudgetWidgets(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function notify() {
  listeners.forEach((fn) => fn());
}

const VALID = new Set(BUDGET_WIDGET_CATALOG.map((w) => w.id));

function normalize(ids: string[]): BudgetWidgetId[] {
  const seen = new Set<BudgetWidgetId>();
  const out: BudgetWidgetId[] = [];
  for (const raw of ids) {
    if (!VALID.has(raw as BudgetWidgetId) || seen.has(raw as BudgetWidgetId)) continue;
    seen.add(raw as BudgetWidgetId);
    out.push(raw as BudgetWidgetId);
  }
  return out;
}

export async function getBudgetWidgets(role: BudgetWidgetRole): Promise<BudgetWidgetId[]> {
  const raw = await AsyncStorage.getItem(key(role));
  if (!raw) return [...BUDGET_WIDGET_DEFAULT];
  try {
    const parsed = normalize(JSON.parse(raw) as string[]);
    return parsed.length ? parsed : [...BUDGET_WIDGET_DEFAULT];
  } catch {
    return [...BUDGET_WIDGET_DEFAULT];
  }
}

export async function setBudgetWidgets(role: BudgetWidgetRole, ids: BudgetWidgetId[]): Promise<BudgetWidgetId[]> {
  const next = normalize(ids);
  await AsyncStorage.setItem(key(role), JSON.stringify(next));
  notify();
  return next;
}

export async function toggleBudgetWidget(role: BudgetWidgetRole, id: BudgetWidgetId): Promise<BudgetWidgetId[]> {
  const cur = await getBudgetWidgets(role);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  return setBudgetWidgets(role, next);
}

export async function resetBudgetWidgets(role: BudgetWidgetRole): Promise<BudgetWidgetId[]> {
  return setBudgetWidgets(role, [...BUDGET_WIDGET_DEFAULT]);
}
