import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  onUndo?: () => void;
}

interface ToastContextType {
  toasts: Toast[];
  toast: (message: string, type: ToastType, duration?: number) => void;
  toastUndo: (message: string, onUndo: () => void, duration?: number) => void;
  removeToast: (id: string) => void;
  pauseToast: (id: string) => void;
  resumeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

interface ToastTimer {
  timeoutId: ReturnType<typeof setTimeout>;
  startedAt: number;
  remaining: number;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ToastTimer>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t.timeoutId);
      timers.current.delete(id);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    clearTimer(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, [clearTimer]);

  const scheduleRemoval = useCallback((id: string, duration: number) => {
    const timeoutId = setTimeout(() => removeToast(id), duration);
    timers.current.set(id, { timeoutId, startedAt: Date.now(), remaining: duration });
  }, [removeToast]);

  const pauseToast = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (!t) return;
    clearTimeout(t.timeoutId);
    const elapsed = Date.now() - t.startedAt;
    t.remaining = Math.max(0, t.remaining - elapsed);
  }, []);

  const resumeToast = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (!t) return;
    t.startedAt = Date.now();
    t.timeoutId = setTimeout(() => removeToast(id), t.remaining);
  }, [removeToast]);

  const toast = useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    const id = `${Date.now()}-${Math.random()}`;
    const newToast: Toast = { id, message, type, duration };

    setToasts((prev) => [...prev.slice(-2), newToast]); // Keep max 3 visible

    if (duration > 0) {
      scheduleRemoval(id, duration);
    }
  }, [scheduleRemoval]);

  const toastUndo = useCallback((message: string, onUndo: () => void, duration = 5000) => {
    const id = `${Date.now()}-${Math.random()}`;
    const newToast: Toast = { id, message, type: 'info', duration, onUndo };

    setToasts((prev) => [...prev.slice(-2), newToast]);

    if (duration > 0) {
      scheduleRemoval(id, duration);
    }
  }, [scheduleRemoval]);

  return (
    <ToastContext.Provider value={{ toasts, toast, toastUndo, removeToast, pauseToast, resumeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
