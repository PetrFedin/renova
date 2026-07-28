/** Clarity E/M: хост для showActionConfirm — один sheet на всё приложение */
import { useEffect, useState } from 'react';
import { ActionConfirmSheet } from '@/components/renova/ActionConfirmSheet';
import {
  clearActionConfirm,
  subscribeActionConfirm,
  type ActionConfirmPayload,
} from '@/lib/actionConfirmBus';

export function ActionConfirmHost() {
  const [payload, setPayload] = useState<ActionConfirmPayload | null>(null);

  useEffect(() => subscribeActionConfirm(setPayload), []);

  return (
    <ActionConfirmSheet
      visible={Boolean(payload)}
      title={payload?.title ?? ''}
      message={payload?.message ?? ''}
      primaryLabel={payload?.primaryLabel}
      onPrimary={payload?.onPrimary}
      primaryDestructive={payload?.primaryDestructive}
      secondaryLabel={payload?.secondaryLabel}
      onSecondary={payload?.onSecondary}
      actions={payload?.actions}
      onDismiss={payload?.onDismiss}
      onClose={() => clearActionConfirm()}
    />
  );
}
