/** Root stack (как job-leads/reports): статический маршрут, иначе /manager-dashboard уходит в динамические catch-all и зацикливает Redirect (Maximum update depth). SoT UI — _stack/manager-dashboard */
export { default } from './_stack/manager-dashboard';
