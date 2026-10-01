import { createBusyGuard, errorMessage } from './busyGuard';

(async () => {
  const states: boolean[] = [];
  const g = createBusyGuard((b) => states.push(b));
  let calls = 0;
  const slow = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); };
  const [a, b] = await Promise.all([g.run(slow), g.run(slow)]);
  if (calls !== 1 || a !== true || b !== false) throw new Error('двойной тап должен дать один вызов');
  if (g.isBusy()) throw new Error('busy должен сброситься');
  let msg = '';
  const ok = await g.run(async () => { throw new Error('Нет сети'); }, (m) => { msg = m; });
  if (ok || msg !== 'Нет сети') throw new Error('ошибка должна дойти до onError');
  if (!(await g.run(async () => undefined))) throw new Error('после ошибки снова доступно');
  if (errorMessage('x') === '') throw new Error('fallback');
  console.log('busyGuard.test OK');
})();
