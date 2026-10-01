import { fallbackDashboard } from './fallbackDashboard';

const d = fallbackDashboard({ id: 'p', name: 'Тест', budget_planned: 0, budget_spent: 0, stages: [] } as never);
if (d.days_overdue !== null) throw new Error('days_overdue: при сбое дашборда — «неизвестно» (null), не 0');
console.log('fallbackDashboard.test OK');
