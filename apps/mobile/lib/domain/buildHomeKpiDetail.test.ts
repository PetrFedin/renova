import { buildHomeKpiDetail, formatHomeKpiTile } from './buildHomeKpiDetail';
import type { ProjectOsSnapshot } from './osTypes';

const closingSnap: ProjectOsSnapshot = {
  isComplete: true,
  pendingPayments: 5,
  pendingPaymentTotal: 315143,
  healthScore: 90,
  healthLevel: 'attention',
  healthLabel: 'Закрытие',
  healthFactors: ['5 счетов к оплате'],
  budget: { planned: 980000, spent: 315143, remaining: 664857, forecast: 980000, overrunRisk: 0 },
  schedule: { progressPercent: 100, delayDays: 0, forecastDelayDays: 0, currentStage: 'Завершён' },
  materials: { needBuy: 0, ordered: 0, delivered: 0, shortage: 0 },
  quality: { awaitingAcceptance: 0, openIssues: 0, criticalIssues: 0 },
  nextAction: { title: 'Оплатить 5 счетов', subtitle: '315 143 ₽', button: 'Оплатить', href: '/budget', kind: 'payment' },
  risks: [],
  activeWorks: [],
  materialNeeds: [],
};

const payTile = formatHomeKpiTile('kpi_budget', closingSnap);
if (payTile.label !== 'Оплаты') throw new Error('closing budget label');
if (!payTile.value.includes('5') || !payTile.value.includes('счет')) throw new Error('closing budget value = bill count');
if (payTile.hint !== 'к оплате') throw new Error('closing budget hint');

const schedTile = formatHomeKpiTile('kpi_schedule', closingSnap);
if (schedTile.hint !== 'работы завершены') throw new Error('closing schedule hint');

const payDetail = buildHomeKpiDetail('kpi_budget', closingSnap, 'customer');
const schedDetail = buildHomeKpiDetail('kpi_schedule', closingSnap, 'customer');
if (!payDetail?.actionLabel.includes('Оплатить')) throw new Error('pay action');
// closing (есть unpaid): schedule KPI ведёт к оплате (OsTabRoute)
const closingHref = schedDetail?.actionHref;
const closingOk =
  typeof closingHref === 'object'
  && closingHref?.pathname?.includes('budget')
  && closingHref?.params?.tab === 'payments';
if (!closingOk) throw new Error('closing schedule → payments');

const completeSnap: ProjectOsSnapshot = { ...closingSnap, pendingPayments: 0, pendingPaymentTotal: 0, healthLabel: 'Завершён', healthLevel: 'good', healthFactors: [] };
const completeSched = buildHomeKpiDetail('kpi_schedule', completeSnap, 'customer');
if (completeSched?.actionHref !== '/documents') throw new Error('complete schedule → documents');

console.log('buildHomeKpiDetail.test OK');
