/** Доменная модель Renova OS — статусы и типы событий */
import type { OsTabRoute } from '@/constants/osSections';

export type OsNavHref = string | OsTabRoute;
export type ProjectHealthLevel = 'good' | 'attention' | 'risk' | 'critical';

export type OsRiskKind = 'budget' | 'schedule' | 'materials' | 'quality' | 'payment';

export type OsEventType =
  | 'ProjectCreated' | 'RoomAdded' | 'WorkStarted' | 'WorkCompleted'
  | 'MaterialOrdered' | 'MaterialDelivered' | 'ExpenseAdded' | 'ReceiptAdded'
  | 'PaymentApproved' | 'InspectionRequested' | 'IssueCreated' | 'IssueFixed' | 'IssueClosed'
  | 'AcceptancePassed' | 'DocumentUploaded';

/** W55: expense = смета/бюджет; work = график/работы */
export type OsNextActionKind = 'accept' | 'expense' | 'material' | 'issue' | 'payment' | 'work' | 'review';

export interface OsRiskItem {
  id: string;
  kind: OsRiskKind;
  title: string;
  impact: string;
  action: string;
  href: OsNavHref;
}

export interface OsKpiBudget {
  planned: number;
  spent: number;
  remaining: number;
  forecast: number;
  overrunRisk: number;
  variancePercent?: number;
}

export interface OsKpiSchedule {
  currentStage?: string;
  plannedEnd?: string;
  forecastEnd?: string;
  forecastDelayDays?: number;
  progressPercent: number;
  delayDays: number;
  riskLevel?: string;
  overdueCount?: number;
  daysOverdue?: number;
}

export interface OsKpiMaterials {
  needBuy: number;
  ordered: number;
  delivered: number;
  shortage: number;
}

export interface OsKpiQuality {
  awaitingAcceptance: number;
  openIssues: number;
  criticalIssues: number;
}

export interface OsNextAction {
  title: string;
  subtitle: string;
  button: string;
  href: OsNavHref;
  kind: OsNextActionKind;
}

export interface ProjectOsSnapshot {
  /** Все этапы завершены или progress ≥ 100 */
  isComplete: boolean;
  /** Счётов к оплате (из API, может отличаться от этапов) */
  pendingPayments: number;
  /** Сумма ожидающих оплат — для KPI «Оплаты» в фазе закрытия */
  pendingPaymentTotal: number;
  healthScore: number;
  healthLevel: ProjectHealthLevel;
  healthLabel: string;
  healthFactors: string[];
  budget: OsKpiBudget;
  schedule: OsKpiSchedule;
  materials: OsKpiMaterials;
  quality: OsKpiQuality;
  nextAction: OsNextAction;
  risks: OsRiskItem[];
  activeWorks: { id: string; name: string; room?: string; status: string; end?: string; href: OsNavHref }[];
  materialNeeds: { id: string; name: string; room?: string; status: string; href: OsNavHref }[];
}
