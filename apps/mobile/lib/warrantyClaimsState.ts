/** Состояния списка гарантийных обращений (fail-closed). */
export type WarrantyListStatus =
  | 'idle'
  | 'loading'
  | 'loaded_empty'
  | 'loaded'
  | 'error'
  | 'refreshing';

export type WarrantyClaimListItem = {
  id: string;
  title?: string;
  status?: string;
  created_at?: string;
  overdue?: boolean;
};

export type WarrantyClaimsState = {
  status: WarrantyListStatus;
  items: WarrantyClaimListItem[];
  open: number;
  overdue: number;
  errorMessage: string | null;
  /** true если есть stale данные при refresh error */
  stale: boolean;
};

export function initialWarrantyClaimsState(): WarrantyClaimsState {
  return {
    status: 'idle',
    items: [],
    open: 0,
    overdue: 0,
    errorMessage: null,
    stale: false,
  };
}

export function warrantyListFromResponse(data: {
  items?: WarrantyClaimListItem[];
  open?: number;
  overdue?: number;
}): Pick<WarrantyClaimsState, 'status' | 'items' | 'open' | 'overdue' | 'errorMessage' | 'stale'> {
  const items = data.items || [];
  const open = data.open ?? items.filter((i) => i.status !== 'closed').length;
  return {
    status: items.length === 0 ? 'loaded_empty' : 'loaded',
    items,
    open,
    overdue: data.overdue ?? 0,
    errorMessage: null,
    stale: false,
  };
}

/** Первичная ошибка — без пустого «обращений нет». */
export function warrantyListInitialError(message: string): WarrantyClaimsState {
  return {
    status: 'error',
    items: [],
    open: 0,
    overdue: 0,
    errorMessage: message,
    stale: false,
  };
}

/** Refresh error — сохраняем старый список + warning. */
export function warrantyListRefreshError(
  prev: WarrantyClaimsState,
  message: string,
): WarrantyClaimsState {
  return {
    ...prev,
    status: prev.items.length ? 'loaded' : prev.status === 'loaded_empty' ? 'loaded_empty' : 'error',
    errorMessage: message,
    stale: prev.items.length > 0 || prev.status === 'loaded_empty',
  };
}

/** Создание fail-closed, если список не загружен успешно. */
export function canSafelyCreateWarranty(state: WarrantyClaimsState): boolean {
  return state.status === 'loaded' || state.status === 'loaded_empty';
}
