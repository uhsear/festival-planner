import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLocation } from '@tanstack/react-router';

interface PageTransitionProps {
  children: React.ReactNode;
}

/**
 * PageTransition: Wrapper component for route transitions using Motion
 * Provides fade+slide animations when navigating between routes
 * Coordinates enter/exit animations with AnimatePresence
 */
export default function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();

  // Use pathname as key to trigger animation on route change
  const key = location.pathname;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: 0.25,
          ease: 'easeOut',
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
