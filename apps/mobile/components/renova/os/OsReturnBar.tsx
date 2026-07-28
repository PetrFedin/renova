/**
 * @deprecated Полоска «Назад» влита в OsPathBar (единый путь).
 * Оставлено как no-op, чтобы старые импорты не дублировали UI.
 */
import type { OsRole } from '@/constants/osSections';

export function OsReturnBar(_props: { role: OsRole }) {
  return null;
}
