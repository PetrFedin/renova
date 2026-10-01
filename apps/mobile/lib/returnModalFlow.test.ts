import { shouldCloseAfterReturn } from './returnModalFlow';

if (!shouldCloseAfterReturn(true)) throw new Error('успех закрывает');
if (!shouldCloseAfterReturn(undefined)) throw new Error('void-обработчик закрывает');
if (shouldCloseAfterReturn(false)) throw new Error('ошибка оставляет модалку открытой');
console.log('returnModalFlow.test OK');
