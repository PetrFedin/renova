import assert from 'node:assert/strict';
import { articleViewState, categoryChips, listViewState, validateArticleForm } from './articleListState';

assert.equal(listViewState({ loading: true, error: false, count: 0, loadedOnce: false }), 'loading');
assert.equal(listViewState({ loading: false, error: true, count: 0, loadedOnce: false }), 'error');
assert.equal(listViewState({ loading: false, error: true, count: 3, loadedOnce: true }), 'ready', 'ошибка обновления не прячет прежние данные');
assert.equal(listViewState({ loading: false, error: false, count: 0, loadedOnce: true }), 'empty');
assert.equal(listViewState({ loading: true, error: false, count: 2, loadedOnce: true }), 'ready');

assert.equal(articleViewState({ loading: true, error: null, hasArticle: false }), 'loading');
assert.equal(articleViewState({ loading: false, error: { status: 404 }, hasArticle: false }), 'not_found');
assert.equal(articleViewState({ loading: false, error: new Error('x'), hasArticle: false }), 'error');
assert.equal(articleViewState({ loading: false, error: null, hasArticle: true }), 'ready');

assert.deepEqual(categoryChips([{ id: 'process', label: 'Процесс' }]), [
  { id: null, label: 'Все' },
  { id: 'process', label: 'Процесс' },
]);

assert.match(validateArticleForm({ slug: '', title: 't', body: 'b' }) ?? '', /идентификатор/i);
assert.match(validateArticleForm({ slug: 'Bad Slug', title: 't', body: 'b' }) ?? '', /латиниц/);
assert.match(validateArticleForm({ slug: 'ok-slug', title: ' ', body: 'b' }) ?? '', /заголовок/);
assert.match(validateArticleForm({ slug: 'ok-slug', title: 't', body: '  ' }) ?? '', /Текст/);
assert.equal(validateArticleForm({ slug: 'ok-slug', title: 't', body: 'b' }), null);

console.log('articleListState tests passed');
