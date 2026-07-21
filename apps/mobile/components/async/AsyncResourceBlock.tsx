/**
 * Универсальный блок: loading / error / empty / stale + children с данными.
 * Ошибка никогда не рендерит empty-copy.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { AsyncResource } from '@/lib/async';
import {
  asyncIsLoading,
  asyncShowEmpty,
  asyncShowError,
  asyncShowStale,
  asyncIsRefreshing,
} from '@/lib/async';
import { InlineError } from './InlineError';
import { StaleDataBanner } from './StaleDataBanner';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';

export function AsyncResourceBlock<T>({
  resource,
  onRetry,
  emptyTitle,
  emptyMessage,
  emptyAction,
  children,
  skeletonRows = 3,
}: {
  resource: AsyncResource<T>;
  onRetry?: () => void;
  emptyTitle: string;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  children: (data: T) => ReactNode;
  skeletonRows?: number;
}) {
  const busy = asyncIsRefreshing(resource);

  if (asyncIsLoading(resource)) {
    return <LoadingSkeleton rows={skeletonRows} />;
  }

  if (asyncShowError(resource)) {
    return (
      <InlineError
        error={resource.error}
        onRetry={onRetry}
        busy={busy}
      />
    );
  }

  return (
    <View>
      {asyncShowStale(resource) ? (
        <StaleDataBanner
          error={resource.error}
          offline={resource.status === 'offline'}
          onRetry={onRetry}
          busy={busy}
        />
      ) : null}
      {asyncShowEmpty(resource) || resource.data == null ? (
        <EmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} />
      ) : (
        children(resource.data)
      )}
    </View>
  );
}
