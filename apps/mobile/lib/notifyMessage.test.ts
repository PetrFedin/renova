import { describeFailure, failureReason } from './notifyMessage';

const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

must(describeFailure(new Error('offline_queued'), 'Не удалось создать этап') === 'Действие выполнится при подключении к интернету.', 'offline_queued is human');
must(describeFailure({ status: 429, message: 'x' }) === 'Слишком много запросов. Подождите несколько секунд и повторите.', 'rate limit by status');
must(describeFailure(new Error('rate_limit')).startsWith('Слишком много'), 'rate_limit code');
must(describeFailure(new Error('Сумма должна быть больше 0'), 'Не удалось сохранить') === 'Не удалось сохранить. Сумма должна быть больше 0', 'what + reason');
must(describeFailure(new Error('Сумма должна быть больше 0'), 'Проверьте подключение') === 'Сумма должна быть больше 0', 'reason wins over hint-only fallback');
must(describeFailure(undefined, 'Не удалось создать этап') === 'Не удалось создать этап', 'no reason keeps what');
must(describeFailure(new TypeError('Failed to fetch'), 'Не удалось создать этап').includes('Нет связи'), 'network');
must(failureReason(new Error('some_unknown_code')) === null, 'unknown snake code not shown raw');
must(failureReason(new Error('{"detail":"x"}')) === null, 'json body not shown raw');
console.log('notifyMessage.test OK');
