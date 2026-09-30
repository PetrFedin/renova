/** Root stack (как job-leads/reports): статический маршрут, иначе /checklist-templates уходит в динамические catch-all и зацикливает Redirect (Maximum update depth). SoT UI — _stack/checklist-templates */
export { default } from './_stack/checklist-templates';
