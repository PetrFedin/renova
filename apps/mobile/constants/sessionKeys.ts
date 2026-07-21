/** Ключи AsyncStorage сессии Renova */
export const SESSION_KEYS = {
  userId: 'renova_user_id',
  accessToken: 'renova_access_token',
  projectId: 'renova_project_id',
  userRole: 'renova_user_role',
  pendingProjectPick: 'renova_pending_project_pick',
  /** Пользователь явно выбрал объект (не автоподхват при старте) */
  projectExplicitlyPicked: 'renova_project_explicitly_picked',
  detailQuizDone: 'renova_detail_quiz_done',
} as const;

/** Флаг «чек прикреплён к счёту» после scan-receipt */
export function paymentReceiptKey(paymentId: string) {
  return `renova_payment_receipt_${paymentId}`;
}
