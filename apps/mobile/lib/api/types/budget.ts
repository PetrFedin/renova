/** Платежи, закупки, чеки, материалы */
export type Payment = {
  id: string;
  title: string;
  amount: number;
  payment_type: string;
  status: string;
  stage_id: string | null;
  notes: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export type MaterialPick = {
  id: string;
  name: string;
  room_id?: string | null;
  stage_id?: string | null;
  qty: number;
  qty_needed?: number | null;
  qty_delivered?: number;
  unit: string;
  price: number;
  category?: string | null;
  shop_url?: string | null;
  shop_name?: string | null;
  work_type?: string | null;
  status: string;
  analog_of_id?: string | null;
  total: number;
};

export type PurchaseItem = {
  id: string;
  material_pick_id?: string | null;
  name: string;
  qty: number;
  unit: string;
  unit_price: number;
  room_id?: string | null;
  stage_id?: string | null;
  total: number;
};

export type Purchase = {
  id: string;
  project_id: string;
  supplier_name?: string | null;
  status: string;
  total_amount: number;
  ordered_at?: string | null;
  paid_at?: string | null;
  delivered_at?: string | null;
  items: PurchaseItem[];
  created_at?: string | null;
};

export type ReceiptItem = {
  id: string;
  amount: number;
  verified: boolean;
  created_at: string;
  receipt_at?: string | null;
  fn?: string | null;
  expense_category?: string;
  room_id?: string | null;
  stage_id?: string | null;
  source?: 'scan' | 'manual';
  description?: string | null;
};

export type MaterialStats = { planned: number; actual: number; overrun_percent: number };

export type ChangeOrder = {
  id: string;
  title: string;
  amount: number;
  status: string;
  description?: string;
};
