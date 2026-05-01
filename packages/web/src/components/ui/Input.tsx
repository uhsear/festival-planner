import React, { useState, useId } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  isPassword?: boolean;
}

export default function Input({
  label,
  error,
  helperText,
  isPassword = false,
  className,
  type,
  id,
  ...props
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const inputType = isPassword && !showPassword ? 'password' : type || 'text';
  const generatedId = useId();
  const inputId = id || generatedId;
  const labelOnly = label && !props['aria-label'];
  const errorId = error ? `${inputId}-error` : undefined;
  const helperId = helperText && !error ? `${inputId}-helper` : undefined;
  const describedBy = [errorId, helperId, props['aria-describedby']]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-text-primary mb-2"
        >
          {label}
        </label>
      )}

      <div className="relative">
        <input
          id={inputId}
          type={inputType}
          aria-label={props['aria-label'] || (labelOnly ? undefined : (props.placeholder || undefined))}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(
            'input-base',
            error && 'border-accent-coral focus-visible:border-accent-coral',
            className
          )}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors inline-flex items-center justify-center"
            style={{ minInlineSize: 44, minBlockSize: 44 }}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff className="w-5 h-5" aria-hidden="true" />
            ) : (
              <Eye className="w-5 h-5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-accent-coral mt-1 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          {error}
        </p>
      )}

      {helperText && !error && (
        <p id={helperId} className="text-sm text-text-muted mt-1">{helperText}</p>
      )}
    </div>
  );
}
