/**
 * Подбор чистовых материалов: кто предлагает и что видит заказчик при согласовании
 * (REP-28, REP-43). Зеркалит backend: предлагать вправе любой пишущий участник,
 * а согласованная позиция получает источник «покупает исполнитель» —
 * а если исполнителя в проекте нет, «покупает заказчик».
 */

export type SelectionRole = 'customer' | 'contractor';

/** Заказчик предлагает позиции только в проекте без исполнителя. */
export function canProposeSelection(input: { role: SelectionRole; readOnly: boolean; selfManaged: boolean }): boolean {
  if (input.readOnly) return false;
  return input.role === 'contractor' || input.selfManaged;
}

/** Кто будет оформлять закупку согласованной позиции. */
export function selectionBuyerLabel(selfManaged: boolean): string {
  return selfManaged ? 'заказчик' : 'исполнитель';
}

export function selectionApproveMessage(input: {
  title?: string | null;
  selfManaged: boolean;
  price: number;
  allowance?: number | null;
  overAllowance?: boolean;
  formatMoney: (value: number) => string;
}): string {
  const lines = [`«${input.title || 'Позиция'}» войдёт в материалы и закупку.`];
  lines.push(`Закупку оформит ${selectionBuyerLabel(input.selfManaged)}.`);
  if (input.overAllowance && input.allowance != null && input.price > input.allowance) {
    lines.push(`Внимание: цена выше лимита на ${input.formatMoney(input.price - input.allowance)} — бюджет вырастет.`);
  } else if (input.overAllowance) {
    lines.push('Внимание: цена выше лимита — бюджет вырастет.');
  }
  return lines.join('\n');
}
