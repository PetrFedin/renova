/**
 * Единая подача «сдать этап» с обратной связью (STG-004/STG-011): канонический вызов
 * сдачи (POST /work-acceptances через RenovaContext.submitStage), офлайн-очередь и
 * человекочитаемый список невыполненных условий при 409/422 completion_gate.
 * Возвращает true, если сдача прошла и показано подтверждение.
 */
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { describeSubmitError } from '@/lib/domain/completionGate';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { alertStageSubmittedForAcceptance } from '@/lib/fieldCreateNav';
import type { OsRole } from '@/constants/osSections';

export async function submitStageWithFeedback(opts: {
  submit: () => Promise<void>;
  role: OsRole;
  /** После успеха — перечитать данные */
  onSubmitted?: () => Promise<void> | void;
  /** «К этапу» в sheet с условиями; без него кнопка просто «Понятно» */
  onOpenStage?: () => void;
  silent?: boolean;
}): Promise<boolean> {
  try {
    await opts.submit();
    await opts.onSubmitted?.();
    if (!opts.silent) alertStageSubmittedForAcceptance(opts.role);
    return true;
  } catch (e: unknown) {
    if (isOfflineQueued(e)) {
      notifyOfflineQueued('Сдача', opts.role);
      return false;
    }
    const gate = describeSubmitError(e);
    if (gate) {
      showActionConfirm({
        title: gate.title,
        message: gate.message,
        primaryLabel: opts.onOpenStage ? 'К этапу' : 'Понятно',
        onPrimary: opts.onOpenStage ?? (() => undefined),
        ...(opts.onOpenStage ? { secondaryLabel: 'Закрыть', onSecondary: () => undefined } : {}),
      });
      return false;
    }
    showActionConfirm({
      title: 'Не удалось сдать',
      message: e instanceof Error && e.message ? e.message : 'Повторите попытку позже.',
      primaryLabel: 'Понятно',
      onPrimary: () => undefined,
    });
    return false;
  }
}
