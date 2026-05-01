import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useHaptics } from './useHaptics';

export interface UsePullToRefreshReturn {
  pullProgress: number;
  isRefreshing: boolean;
  bind: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
  };
}

export interface UsePullToRefreshProps {
  /**
   * Threshold in pixels to trigger refresh (default: 80)
   */
  threshold?: number;
  /**
   * Time in milliseconds to auto-reset after refresh (default: 1500)
   */
  resetDelay?: number;
  /**
   * Query keys to invalidate on refresh
   */
  queryKeys?: readonly unknown[][];
}

/**
 * Pull-to-refresh hook for TanStack Query
 * Detects pull-down gesture when scrolled to top and invalidates queries
 * Includes haptic feedback on trigger and visual progress indicator
 *
 * @param props - Configuration object
 * @param props.threshold - Pixel distance to trigger refresh (default: 80)
 * @param props.resetDelay - Time before auto-reset (default: 1500ms)
 * @param props.queryKeys - Query keys to invalidate (default: invalidates all)
 * @returns Object with pull progress (0-1), refresh state, and touch event handlers
 *
 * @example
 * const { pullProgress, isRefreshing, bind } = usePullToRefresh({
 *   threshold: 80,
 *   queryKeys: [['sets'], ['festival']],
 * });
 * return (
 *   <div {...bind} style={{ overscrollBehavior: 'none' }}>
 *     {pullProgress > 0 && <RefreshIndicator progress={pullProgress} />}
 *   </div>
 * );
 */
export function usePullToRefresh({
  threshold = 80,
  resetDelay = 1500,
  queryKeys = [],
}: UsePullToRefreshProps = {}): UsePullToRefreshReturn {
  const queryClient = useQueryClient();
  const { success } = useHaptics();

  const [pullProgress, setPullProgress] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Check if element is scrolled to top
  const isAtTop = useCallback((element: Element): boolean => {
    return element.scrollTop === 0;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only track if at top of scroll
    const target = e.currentTarget as Element;
    if (!isAtTop(target)) {
      isDraggingRef.current = false;
      return;
    }

    startYRef.current = e.touches[0]?.clientY || 0;
    currentYRef.current = startYRef.current;
    isDraggingRef.current = true;
  }, [isAtTop]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;

    currentYRef.current = e.touches[0]?.clientY || 0;
    const distance = Math.max(0, currentYRef.current - startYRef.current);

    // Calculate progress (0-1) up to threshold, capped at 1
    const progress = Math.min(distance / threshold, 1);
    setPullProgress(progress);
  }, [threshold]);

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;

    const distance = Math.max(0, currentYRef.current - startYRef.current);
    isDraggingRef.current = false;

    // Trigger refresh if threshold met
    if (distance >= threshold) {
      setIsRefreshing(true);
      setPullProgress(1);
      success(); // Haptic feedback

      // Invalidate queries
      if (queryKeys.length > 0) {
        queryKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      } else {
        // Invalidate all queries if no specific keys provided
        queryClient.invalidateQueries();
      }

      // Auto-reset after delay
      resetTimeoutRef.current = setTimeout(() => {
        setIsRefreshing(false);
        setPullProgress(0);
      }, resetDelay);
    } else {
      // Reset if threshold not met
      setPullProgress(0);
    }
  }, [threshold, queryKeys, queryClient, success, resetDelay]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  return {
    pullProgress,
    isRefreshing,
    bind: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}
