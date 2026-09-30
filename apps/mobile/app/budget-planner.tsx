/** Root stack (как job-leads/reports): статический маршрут, иначе /budget-planner уходит в динамические catch-all и зацикливает Redirect (Maximum update depth). SoT UI — _stack/budget-planner */
export { default } from './_stack/budget-planner';
