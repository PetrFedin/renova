/** Типы для расчётного движка смет Renova */

export type RenovationType = 'cosmetic' | 'capital' | 'bathroom' | 'kitchen';

export interface RoomDimensions {
  lengthM: number;
  widthM: number;
  heightM: number;
  /** Площадь проёмов (двери, окна) в м² */
  openingsSqM?: number;
}

export interface RoomMetrics {
  floorSqM: number;
  wallSqM: number;
  perimeterM: number;
  volumeCuM: number;
}

export interface MaterialLine {
  id: string;
  name: string;
  unit: 'm2' | 'm' | 'pcs' | 'kg' | 'l';
  quantity: number;
  unitPrice: number;
  roomId?: string;
}

export interface WorkLine {
  id: string;
  name: string;
  unit: 'm2' | 'm' | 'pcs' | 'point';
  quantity: number;
  ratePerUnit: number;
  roomId?: string;
}

export interface EstimateSummary {
  materialsTotal: number;
  worksTotal: number;
  subtotal: number;
  reservePercent: number;
  reserveAmount: number;
  grandTotal: number;
}

export interface ProjectDashboard {
  progressPercent: number;
  budgetPlanned: number;
  budgetSpent: number;
  budgetVariancePercent: number;
  materialOverrunPercent: number;
  daysOverdue: number;
}
