import { cn } from '../../lib/utils';

interface Props {
  myReminder: number | undefined;
  reminderBusy: number | null | 'clear';
  onReminderClick: (minutes: number | null) => Promise<void>;
}

// Must match the server's allowed lead times (ALLOWED_REMINDER_MINUTES).
const options: Array<[number, string]> = [
  [5, '5m'],
  [10, '10m'],
  [15, '15m'],
  [30, '30m'],
  [60, '1h'],
];

const baseButtonClass =
  'flex-1 py-2.5 rounded-sm text-center bg-bg-card border-2 border-border cursor-pointer transition-[background-color,border-color,transform] duration-200 ease-[var(--ease-standard)] text-text-primary touch-manipulation appearance-none hover:border-text-muted hover:bg-bg-card-hover active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2';

export default function DetailReminderPicker({ myReminder, reminderBusy, onReminderClick }: Props) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-secondary mb-2">
        Remind me before it starts
      </div>
      <div className="flex gap-2 mb-6">
        {options.map(([m, label]) => {
          const active = myReminder === m;
          const isThisBusy = reminderBusy === m;
          const anyBusy = reminderBusy !== null;
          return (
            <button
              key={m}
              className={cn(baseButtonClass, active && 'border-accent-aqua bg-[var(--color-aqua-a08)]')}
              type="button"
              aria-pressed={active ? 'true' : 'false'}
              aria-label={active ? `Reminder ${label} before, click to clear` : `Remind me ${label} before`}
              aria-busy={isThisBusy ? 'true' : 'false'}
              disabled={anyBusy}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (reminderBusy !== null) return;
                await onReminderClick(active ? null : m);
              }}
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.5px]">{label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
