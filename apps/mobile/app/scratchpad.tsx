/** Root stack (как job-leads/reports): статический маршрут, иначе /scratchpad уходит в динамические catch-all и зацикливает Redirect (Maximum update depth). SoT UI — _stack/scratchpad */
export { default } from './_stack/scratchpad';
