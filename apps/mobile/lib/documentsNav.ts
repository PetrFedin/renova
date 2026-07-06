/** Единая точка входа в документы — primary: меню в шапке; deep links через эту функцию */
export function documentsHref(returnTo?: string) {
  return returnTo
    ? ({ pathname: '/documents' as const, params: { returnTo } })
    : ({ pathname: '/documents' as const });
}

export const DOCUMENTS_MENU_HINT = 'Документы, смета и экспорт — раздел «Документы» в меню ↑';
