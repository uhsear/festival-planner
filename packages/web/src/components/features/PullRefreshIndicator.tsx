import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

interface PullRefreshIndicatorProps {
  progress: number;
  isRefreshing: boolean;
}

export default function PullRefreshIndicator({ progress, isRefreshing }: PullRefreshIndicatorProps) {
  const prefersReducedMotion = useReducedMotion();
  // Don't render if no progress and not refreshing
  if (progress === 0 && !isRefreshing) {
    return null;
  }

  const opacity = Math.max(0, Math.min(1, (progress - 0.1) / 0.4));
  const scale = 0.5 + progress * 0.5;

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label={isRefreshing ? 'Refreshing content' : 'Pull to refresh'}
      className="fixed top-4 left-1/2 z-50 flex items-center justify-center"
      style={{
        transform: 'translateX(-50%)',
      }}
      animate={{
        opacity: isRefreshing ? 1 : opacity,
        scale: isRefreshing ? 1 : scale,
      }}
      transition={{
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 },
      }}
    >
      <div className="relative w-10 h-10">
        {/* Glass background circle */}
        <div className={cn(
          'absolute inset-0 rounded-full',
          'bg-glass border border-border-light',
          'backdrop-blur-md',
        )} />

        {/* Progress ring background */}
        <svg
          className="absolute inset-0 w-10 h-10 transform -rotate-90"
          viewBox="0 0 40 40"
        >
          {/* Background circle */}
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-border opacity-30"
          />

          {/* Progress arc */}
          <motion.circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            strokeWidth="2"
            className="text-accent-aqua"
            strokeDasharray={100.5}
            strokeDashoffset={100.5}
            animate={{
              strokeDashoffset: isRefreshing
                ? 100.5
                : 100.5 - progress * 100.5,
            }}
            transition={{
              duration: isRefreshing ? 0 : 0.1,
            }}
            strokeLinecap="round"
          />

          {isRefreshing && !prefersReducedMotion && (
            <motion.circle
              cx="20"
              cy="20"
              r="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-accent-aqua"
              animate={{
                rotate: 360,
              }}
              transition={{
                rotate: {
                  duration: 1,
                  repeat: Infinity,
                  ease: 'linear',
                },
              }}
              style={{
                transformOrigin: '20px 20px',
              }}
            />
          )}
        </svg>

        {/* Center icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            animate={{
              rotate: isRefreshing && !prefersReducedMotion ? 360 : 0,
            }}
            transition={{
              rotate: {
                duration: isRefreshing && !prefersReducedMotion ? 1 : 0.2,
                repeat: isRefreshing && !prefersReducedMotion ? Infinity : 0,
                ease: 'linear',
              },
            }}
            style={{
              transformOrigin: 'center',
            }}
          >
            {/* Refresh/arrow icon SVG */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="text-accent-aqua"
            >
              {/* Curved arrow icon */}
              <path
                d="M3 10a7 7 0 1 1 14 0"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              {/* Arrowhead */}
              <path
                d="M14 6v4h4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
