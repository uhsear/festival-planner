import React from 'react';
import { AlertCircle, CheckCircle, Info, AlertTriangle, X, RotateCcw } from 'lucide-react';
import { useToast } from '../../lib/toastContext';
import { cn } from '../../lib/utils';

export default function Toast() {
  const { toasts, removeToast } = useToast();

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5" />;
      case 'error':
        return <AlertCircle className="w-5 h-5" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5" />;
      default:
        return <Info className="w-5 h-5" />;
    }
  };

  const getColorClasses = (type: string) => {
    switch (type) {
      case 'success':
        return 'text-accent-green bg-accent-green bg-opacity-10 border-accent-green border-opacity-30';
      case 'error':
        return 'text-accent-coral bg-accent-coral bg-opacity-10 border-accent-coral border-opacity-30';
      case 'warning':
        return 'text-accent-amber bg-accent-amber bg-opacity-10 border-accent-amber border-opacity-30';
      default:
        return 'text-accent-aqua bg-accent-aqua bg-opacity-10 border-accent-aqua border-opacity-30';
    }
  };

  return (
    <div className="fixed bottom-24 right-4 left-4 z-50 flex flex-col gap-2 pointer-events-none sm:left-auto sm:max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'glass p-4 rounded-lg flex-between gap-3 pointer-events-auto toast-enter',
            getColorClasses(t.type)
          )}
        >
          <div className="flex gap-3 items-start flex-1">
            {getIcon(t.type)}
            <div className="flex-1">
              <p className="text-sm font-medium">{t.message}</p>
              {t.onUndo && (
                <button
                  onClick={t.onUndo}
                  className="text-xs mt-1 opacity-75 hover:opacity-100 flex items-center gap-1 transition-opacity"
                >
                  <RotateCcw className="w-3 h-3" />
                  Undo
                </button>
              )}
            </div>
          </div>

          <button
            onClick={() => removeToast(t.id)}
            className="p-1 hover:bg-white hover:bg-opacity-10 rounded transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
