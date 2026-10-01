/** DOC-010: «Нужно подписать» считается по подписям, а не по статусу draft. */
export type SignableDoc = {
  status?: string;
  meta?: { signatures?: { signer_user_id?: string | null; status?: string }[] } | null;
};

/** Документ ждёт подпись именно этого пользователя: draft и нет его действующей подписи. */
export function awaitsMySignature(doc: SignableDoc, userId: string | null | undefined): boolean {
  if (doc.status !== 'draft' || !userId) return false;
  const sigs = doc.meta?.signatures ?? [];
  return !sigs.some((s) => s.signer_user_id === userId && s.status === 'signed');
}

/** Путь просмотра документа гостем портала (Bearer портала, scope read). */
export function portalDocumentContentPath(projectId: string, documentId: string): string {
  return `/api/v1/portal/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/content`;
}
