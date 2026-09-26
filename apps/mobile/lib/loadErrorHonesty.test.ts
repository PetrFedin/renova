/**
 * Экран загрузки не должен списывать чужую беду на сеть. На 429 сеть
 * в порядке: сервер просит подождать, а немедленный повтор продлевает
 * ограничение. Приложение это различать умеет — экран обязан пользоваться.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const state = src('components/ui/LoadErrorState.tsx');
const control = src('components/screens/control/CustomerControlView.tsx');

if (!state.includes('loadErrorHint(error)')) throw new Error('подсказка не зависит от ошибки');
if (!state.includes('retryIsImmediate(error)')) throw new Error('кнопка повтора не учитывает лимит');
if (!state.includes("immediate ? 'Повторить' : 'Повторить позже'")) {
  throw new Error('при 429 кнопка обязана звать позже');
}
if (/hint = 'Проверьте сеть и повторите/.test(state)) {
  throw new Error('жёсткая подсказка про сеть вернулась значением по умолчанию');
}
if (!state.includes('hint ?? loadErrorHint(error)')) {
  throw new Error('явная подсказка вызывающего должна иметь приоритет');
}

if (!control.includes('setLoadError(e)')) throw new Error('экран приёмки не сохраняет ошибку');
if (!control.includes('error={loadError}')) throw new Error('экран приёмки не передаёт ошибку');
const reload = control.split('const reload = useCallback')[1]?.slice(0, 800) ?? '';
if (!reload.includes('setLoadError(null)')) throw new Error('старая ошибка не сбрасывается перед повтором');

console.log('loadErrorHonesty.test OK');
