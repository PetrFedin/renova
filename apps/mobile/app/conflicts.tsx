/** Root stack (как job-leads/reports): статический маршрут, иначе /conflicts уходит в динамические catch-all и зацикливает Redirect (Maximum update depth). SoT UI — _stack/conflicts */
export { default } from './_stack/conflicts';
