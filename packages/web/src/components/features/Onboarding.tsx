import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { X, Music, Users, Sparkles, ChevronRight } from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { useKeyboardTrap } from '../../hooks/useKeyboardTrap';
import { cn } from '../../lib/utils';

const STORAGE_KEY = 'festie_onboarding_completed';

function isOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function markOnboardingCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // localStorage unavailable — silently ignore
  }
}

interface StepConfig {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const STEPS: StepConfig[] = [
  {
    icon: <Sparkles className="w-10 h-10 text-accent-aqua" />,
    title: 'Welcome to Festie!',
    description:
      'Your crew coordination hub for festivals. Pick your favorite sets, plan with friends, and never miss a must-see act.',
  },
  {
    icon: <Music className="w-10 h-10 text-accent-coral" />,
    title: 'Choose Your Festival',
    description:
      "Browse available festivals and select the one you're attending. You'll get the full lineup, schedule, and stage map.",
  },
  {
    icon: <Users className="w-10 h-10 text-accent-amber" />,
    title: 'Join or Create a Crew',
    description:
      'Coordinate with your friends in real time. Create a new crew or join an existing one to share picks and chat.',
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(() => !isOnboardingCompleted());
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    markOnboardingCompleted();
    setVisible(false);
  }, []);

  // Focus management + keyboard trap. The shared hook moves initial focus into
  // the card on mount, wraps Tab / Shift+Tab so focus can't escape to the page
  // behind the modal, closes on Escape (WCAG 2.1.2), and restores focus to the
  // previously-focused element on unmount.
  useKeyboardTrap(cardRef, visible, dismiss);

  // Prevent the page behind the modal from scrolling while onboarding is open.
  useEffect(() => {
    if (!visible) return;
    const { documentElement, body } = document;
    const prevBody = body.style.overflow;
    const prevHtml = documentElement.style.overflow;
    body.style.overflow = 'hidden';
    documentElement.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prevBody;
      documentElement.style.overflow = prevHtml;
    };
  }, [visible]);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      // Final step — complete onboarding and navigate to lineup
      dismiss();
      navigate({ to: '/cards' });
    }
  }, [step, dismiss, navigate]);

  if (!visible) return null;

  const current = STEPS[step]!;
  const isLastStep = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 'var(--z-modal)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Festie"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={dismiss} aria-hidden="true" />

      {/* Card */}
      <div
        ref={cardRef}
        className={cn(
          'relative w-full max-w-sm rounded-2xl border border-border-light',
          'bg-bg-primary shadow-2xl p-6 flex flex-col items-center text-center',
        )}
      >
        {/* Close button */}
        <div className="absolute top-2 right-2">
          <IconButton icon={<X className="w-5 h-5" />} label="Dismiss onboarding" onClick={dismiss} />
        </div>

        {/* Step icon */}
        <div className="mt-2 mb-4 flex items-center justify-center w-20 h-20 rounded-full bg-bg-card border border-border">
          {current.icon}
        </div>

        {/* Step content */}
        <h2 className="text-xl font-display font-bold text-text-primary mb-2">{current.title}</h2>
        <p className="text-sm text-text-secondary leading-relaxed max-w-xs mb-6">{current.description}</p>

        {/* Step indicators */}
        <div
          className="flex items-center gap-2 mb-6"
          role="progressbar"
          aria-label={`Step ${step + 1} of ${STEPS.length}`}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
        >
          {STEPS.map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === step ? 'w-6 bg-accent-aqua' : 'w-1.5 bg-text-muted/30',
              )}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex w-full gap-3">
          {!isLastStep && (
            <Button variant="ghost" size="md" className="flex-1" onClick={dismiss}>
              Skip
            </Button>
          )}
          <Button variant="primary" size="md" className="flex-1" onClick={handleNext}>
            <span className="flex items-center gap-1">
              {isLastStep ? 'Get Started' : 'Next'}
              <ChevronRight className="w-4 h-4" />
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
