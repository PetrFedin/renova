import { loadErrorHint, loadErrorKind, retryIsImmediate } from './loadErrorHint';

if (loadErrorKind({ status: 429 }) !== 'rate_limit') throw new Error('429 по статусу');
if (loadErrorKind({ code: 'rate_limit' }) !== 'rate_limit') throw new Error('429 по коду');
if (loadErrorKind({ message: 'Слишком много запросов. Подождите.' }) !== 'rate_limit') {
  throw new Error('429 по сообщению');
}
if (loadErrorKind({ status: 500 }) !== 'server') throw new Error('500');
if (loadErrorKind({ status: 503 }) !== 'server') throw new Error('503');
if (loadErrorKind({ status: 0 }) !== 'offline') throw new Error('запрос не дошёл');
if (loadErrorKind({ code: 'timeout' }) !== 'offline') throw new Error('таймаут');
if (loadErrorKind({ status: 404 }) !== 'unknown') throw new Error('404 — не сеть и не лимит');
if (loadErrorKind(null) !== 'unknown') throw new Error('без ошибки');
if (loadErrorKind('строка') !== 'unknown') throw new Error('строка вместо ошибки');

if (!loadErrorHint({ status: 429 }).startsWith('Сервер просит подождать')) throw new Error('подсказка 429');
if (loadErrorHint({ status: 429 }).includes('Проверьте сеть')) throw new Error('на 429 нельзя звать проверять сеть');
if (!loadErrorHint({ status: 502 }).startsWith('Сбой на стороне сервера')) throw new Error('подсказка 5xx');
if (!loadErrorHint({ status: 0 }).startsWith('Проверьте сеть')) throw new Error('подсказка обрыва');
if (loadErrorHint(null) !== 'Проверьте сеть и повторите. Это не пустой список.') {
  throw new Error('запасная подсказка прежняя');
}
if (loadErrorHint(null, 'Своя подсказка') !== 'Своя подсказка') throw new Error('своя подсказка уважается');

if (retryIsImmediate({ status: 429 })) throw new Error('при 429 повтор не мгновенный');
if (!retryIsImmediate({ status: 500 })) throw new Error('при сбое сервера повтор уместен');
if (!retryIsImmediate(null)) throw new Error('без ошибки повтор уместен');

console.log('loadErrorHint.test OK');
