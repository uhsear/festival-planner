import React, { ReactNode } from 'react';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import PullRefreshIndicator from '../features/PullRefreshIndicator';
import { cn } from '@/lib/utils';

interface RefreshableViewProps {
  /**
   * Content to render inside the scrollable view
   */
  children: ReactNode;

  /**
   * Query keys to invalidate on refresh
   * @example [['sets'], ['festival']]
   */
  queryKeys?: readonly unknown[][];

  /**
   * Optional CSS class name
   */
  className?: string;
}

/**
 * A scrollable view wrapper with integrated pull-to-refresh gesture support
 * Combines pull-to-refresh hook with a visual indicator and scrollable container
 * Prevents native mobile pull-to-refresh interference with overscroll-behavior
 *
 * @example
 * <RefreshableView queryKeys={[['sets'], ['festival']]}>
 *   <div>Your content here</div>
 * </RefreshableView>
 */
export default function RefreshableView({
  children,
  queryKeys = [],
  className,
}: RefreshableViewProps) {
  const { pullProgress, isRefreshing, bind } = usePullToRefresh({
    threshold: 80,
    queryKeys,
  });

  return (
    <div
      {...bind}
      className={cn(
        'overflow-y-auto overscroll-behavior-none',
        'touch-action-pan-y',
        className,
      )}
      /* overscroll-behavior + touch-action already set via Tailwind in className */
    >
      <PullRefreshIndicator progress={pullProgress} isRefreshing={isRefreshing} />
      {children}
    </div>
  );
}
