import { InfoBanner } from '@/components/ui/InfoBanner';
import { useRenova } from '@/lib/context/RenovaContext';
import { t } from '@/lib/i18n';

export function ReadOnlyBanner() {
  const { readOnly } = useRenova();
  if (!readOnly) return null;
  return <InfoBanner tone="warning" message={t('readOnly')} />;
}

export function useWriteAllowed() {
  const { readOnly } = useRenova();
  return !readOnly;
}
