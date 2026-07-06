import { ProjectDetail } from '@/lib/api';
import { tabsRoute } from '@/constants/osSections';
import type { OsNavHref } from '@/lib/pushOsNav';

export type AttentionItem = { id: string; title: string; subtitle: string; href: OsNavHref; kind: 'review' | 'deadline' | 'payment' | 'chat' };

export function buildAttention(project: ProjectDetail, role: 'customer' | 'contractor'): AttentionItem[] {
  const items: AttentionItem[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const s of project.stages) {
    if (s.status === 'review' && role === 'customer') {
      items.push({ id: `rev-${s.id}`, title: `Приёмка: ${s.name}`, subtitle: 'Исполнитель ждёт подтверждения', href: `/stage/${s.id}`, kind: 'review' });
    }
    if (s.status === 'active' && role === 'contractor' && !s.contractor_ready) {
      items.push({ id: `act-${s.id}`, title: `В работе: ${s.name}`, subtitle: 'Отметьте готовность', href: `/stage/${s.id}`, kind: 'review' });
    }
    if (s.planned_end && s.planned_end < today && s.status !== 'done') {
      items.push({ id: `dl-${s.id}`, title: `Просрочка: ${s.name}`, subtitle: `Дедлайн ${s.planned_end}`, href: `/stage/${s.id}`, kind: 'deadline' });
    }
  }
  const pendingPay = project.stages.filter((s) => s.status === 'done' && !s.customer_accepted_at);
  if (pendingPay.length && role === 'customer') {
    items.push({ id: 'pay', title: 'Оплата этапов', subtitle: `${pendingPay.length} этап(ов)`, href: tabsRoute('customer', 'budget'), kind: 'payment' });
  }
  if (project.budget_planned > 0 && project.budget_spent >= project.budget_planned * 0.9) {
    items.unshift({
      id: 'budget', title: 'Бюджет почти исчерпан',
      subtitle: `${Math.round(project.budget_spent / project.budget_planned * 100)}% от сметы`,
      href: tabsRoute(role, 'budget'), kind: 'payment',
    });
  }
  return items.slice(0, 6);
}
