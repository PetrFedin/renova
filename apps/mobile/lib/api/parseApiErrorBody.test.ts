/** 422 FastAPI не должен доходить до пользователя сырым JSON. */
process.env.EXPO_PUBLIC_API_URL ||= 'http://127.0.0.1:8100';

import { parseApiErrorBody } from './client';
import { validationMessage, isHumanMessage } from './validationMessage';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};

const body422 = JSON.stringify({
  detail: [{ type: 'string_too_long', loc: ['body', 'phone'], msg: 'String should have at most 20 characters', ctx: { max_length: 20 } }],
});
const p = parseApiErrorBody(body422, 422);
must(p.message === 'Сервер не принял данные формы: «phone» — не длиннее 20 символов.', `422 message: ${p.message}`);
must(p.code === 'validation_error', 'code');
must(Array.isArray(p.detail), 'detail сохранён');
must(!p.message.includes('{') && !p.message.includes('"detail"'), 'нет сырого JSON');

const missing = parseApiErrorBody(JSON.stringify({ detail: [{ type: 'missing', loc: ['body', 'code'] }] }), 422);
must(missing.message.includes('«code» — заполните поле'), 'missing');

const many = validationMessage([1, 2, 3, 4].map(() => ({ type: 'missing', loc: ['body', 'x'] })));
must(!!many && many.includes('и ещё 1'), 'more suffix');
must(validationMessage([]) === null && validationMessage('x') === null, 'not validation');

// Прежние форматы не сломаны.
must(parseApiErrorBody(JSON.stringify({ detail: 'invalid_code' }), 400).message === 'invalid_code', 'string detail');
must(parseApiErrorBody(JSON.stringify({ detail: { code: 'c', message: 'Текст' } }), 400).message === 'Текст', 'object detail');
must(parseApiErrorBody('{}', 429).code === 'rate_limit', 'rate limit');
must(parseApiErrorBody('Bad gateway', 502).message === 'Bad gateway', 'plain text');

// Нераспознанный JSON / HTML не показываем как есть.
const raw = parseApiErrorBody(JSON.stringify({ detail: [{ weird: true }] }), 422);
must(!raw.message.startsWith('[') && !raw.message.startsWith('{'), `raw json leaked: ${raw.message}`);
const html = parseApiErrorBody('<!doctype html><html>err</html>', 500);
must(html.message.includes('HTTP 500') && !html.message.includes('<'), 'html hidden');
must(parseApiErrorBody('', 500).message.includes('HTTP 500'), 'empty');
must(isHumanMessage('Привет') && !isHumanMessage('{"a":1}'), 'isHumanMessage');

console.log('parseApiErrorBody tests OK');
