import { AlertCircle, CheckCircle, Info, AlertTriangle, X, RotateCcw } from 'lucide-react';
import { useToast } from '../../lib/toastContext';
import { cn } from '../../lib/utils';

export default function Toast() {
  const { toasts, removeToast, pauseToast, resumeToast } = useToast();

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5" aria-hidden="true" />;
      case 'error':
        return <AlertCircle className="w-5 h-5" aria-hidden="true" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5" aria-hidden="true" />;
      default:
        return <Info className="w-5 h-5" aria-hidden="true" />;
    }
  };

  const getColorClasses = (type: string) => {
    switch (type) {
      case 'success':
        return 'text-accent-green bg-accent-green/10 border-accent-green/30';
      case 'error':
        return 'text-accent-coral bg-accent-coral/10 border-accent-coral/30';
      case 'warning':
        return 'text-accent-amber bg-accent-amber/10 border-accent-amber/30';
      default:
        return 'text-accent-aqua bg-accent-aqua/10 border-accent-aqua/30';
    }
  };

  return (
    <div
      className="fixed bottom-24 right-4 left-4 z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none sm:left-auto sm:max-w-sm"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => {
        const isAlert = t.type === 'error' || t.type === 'warning';
        const roleAttr: { role: 'alert' | 'status' } = { role: isAlert ? 'alert' : 'status' };
        return (
          <div
            key={t.id}
            {...roleAttr}
            className={cn(
              'glass p-4 rounded-lg flex-between gap-3 pointer-events-auto toast-enter',
              getColorClasses(t.type),
            )}
            onMouseEnter={() => pauseToast(t.id)}
            onMouseLeave={() => resumeToast(t.id)}
            onFocus={() => pauseToast(t.id)}
            onBlur={() => resumeToast(t.id)}
          >
            <div className="flex gap-3 items-start flex-1">
              {getIcon(t.type)}
              <div className="flex-1">
                <p className="text-sm font-medium">{t.message}</p>
                {t.onUndo && (
                  <button
                    type="button"
                    onClick={t.onUndo}
                    className="text-xs mt-1 opacity-75 hover:opacity-100 flex items-center gap-1 transition-opacity min-h-11 min-w-11"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Undo
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="p-1 hover:bg-white hover:bg-opacity-10 rounded transition-colors flex-shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
