/** Состояния экранов статей/гида: загрузка / ошибка с «Повторить» / пусто / список. */

export type ListViewState = 'loading' | 'error' | 'empty' | 'ready';

export function listViewState(input: { loading: boolean; error: boolean; count: number; loadedOnce: boolean }): ListViewState {
  if (input.error && input.count === 0) return 'error';
  if (input.loading && !input.loadedOnce) return 'loading';
  if (input.count === 0) return 'empty';
  return 'ready';
}

export type ArticleViewState = 'loading' | 'error' | 'not_found' | 'ready';

export function articleViewState(input: { loading: boolean; error: unknown; hasArticle: boolean }): ArticleViewState {
  if (input.hasArticle) return 'ready';
  if (input.error) {
    const status = (input.error as { status?: number }).status;
    return status === 404 ? 'not_found' : 'error';
  }
  return 'loading';
}

/** Категории для фильтра: «Все» + то, что вернул API. */
export function categoryChips(categories: { id: string; label: string }[]): { id: string | null; label: string }[] {
  return [{ id: null, label: 'Все' }, ...categories.map((c) => ({ id: c.id, label: c.label }))];
}

export type ArticleFormInput = { slug: string; title: string; body: string };

/** Клиентская проверка перед сохранением; backend требует непустой текст (422). */
export function validateArticleForm(f: ArticleFormInput): string | null {
  if (!f.slug.trim()) return 'Укажите идентификатор (латиница, через дефис)';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f.slug.trim())) return 'Идентификатор: строчная латиница, цифры и дефисы';
  if (!f.title.trim()) return 'Укажите заголовок';
  if (!f.body.trim()) return 'Текст статьи не должен быть пустым';
  return null;
}
