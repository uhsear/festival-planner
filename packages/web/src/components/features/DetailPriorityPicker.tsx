import { Priority } from '@festie/shared/types';

interface Props {
  myPick: Priority | null;
  priorityBusy: Priority | null | 'clear';
  onPriorityClick: (priority: Priority | null) => Promise<void>;
}

const priorityOptions: Array<[Priority | null, string, string, string]> = [
  ['must', '★', 'Must See', 'active-must'],
  ['want-to-see', '◆', 'Want to See', 'active-want'],
  ['maybe', '●', 'Maybe', 'active-maybe'],
  [null, '✕', 'Clear', 'active-none'],
];

export default function DetailPriorityPicker({
  myPick, priorityBusy, onPriorityClick,
}: Props) {
  return (
    <div className="detail-priority-group">
      {priorityOptions.map(([p, icon, label, cls]) => {
        const active = myPick === p;
        const key: Priority | 'clear' = p ?? 'clear';
        const isThisBusy = priorityBusy === key;
        const anyBusy = priorityBusy !== null;
        return (
          <button
            key={label}
            className={
              'detail-priority-option' + (active ? ' ' + cls : '')
            }
            type="button"
            aria-pressed={active ? 'true' : 'false'}
            aria-label={label + (active ? ' (selected)' : '')}
            aria-busy={isThisBusy ? 'true' : 'false'}
            disabled={anyBusy}
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (priorityBusy !== null) return;
              await onPriorityClick(p);
            }}
          >
            <div style={{ fontSize: '20px' }}>{icon}</div>
            <div className="priority-label">{label}</div>
          </button>
        );
      })}
    </div>
  );
}
