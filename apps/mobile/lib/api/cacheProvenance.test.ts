/**
 * #317: провенанс обязан ехать вместе с результатом.
 *
 * Прежде `req` мог молча отдать значение из долговременного кэша как успех,
 * а `cachedGet` записывал его как свежий ответ — обновлял возраст и помечал
 * `stale: false`. Отметка при этом лежала в одной переменной на все запросы,
 * поэтому свежий ответ по одному пути стирал устаревание по другому.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const client = readFileSync(join(__dirname, 'client.ts'), 'utf8');
const banner = readFileSync(
  join(__dirname, '..', '..', 'components', 'renova', 'StaleCacheBanner.tsx'),
  'utf8',
);

// 1. Единой «последней» переменной больше нет.
if (client.includes('_lastCachedGetMeta')) {
  throw new Error('провенанс снова лежит в одной переменной на все запросы');
}
if (!client.includes('const _cacheMeta = new Map<string, CachedGetMeta>()')) {
  throw new Error('нет разбора провенанса по путям');
}

// 2. req сообщает, что подменил ответ кэшем.
const reqTail = client.split('if (isGet && cacheFallback && canFallbackToCache(error))')[1] ?? '';
if (!reqTail.includes('provenance.servedFromDurableCache = true')) {
  throw new Error('req отдаёт кэш молча — вызывающий не отличит его от свежего ответа');
}

// 3. cachedGet не выдаёт кэш за свежий ответ и не подновляет возраст.
const cached = client.split('export async function cachedGet')[1]?.split('\nexport ')[0] ?? '';
if (!cached.includes('if (provenance.servedFromDurableCache)')) {
  throw new Error('cachedGet не проверяет провенанс');
}
const laundering = cached.split('if (provenance.servedFromDurableCache)')[1]?.split('return v;')[0] ?? '';
if (laundering.includes('saveDurableCache(')) {
  throw new Error('старое значение переписывается в кэш как свежее');
}
if (/_cache\.set\(k, \{ t: now/.test(laundering)) {
  throw new Error('возраст старого значения подновляется');
}
if (!laundering.includes('stale: true')) throw new Error('кэшевый ответ не помечен устаревшим');

// 4. Баннер спрашивает про все пути, а не про последний ответ.
if (banner.includes('getLastCachedGetMeta')) throw new Error('баннер читает «последний ответ»');
if (!banner.includes('getStaleCachePaths()')) throw new Error('баннер не спрашивает про все пути');

console.log('cacheProvenance.test OK');
