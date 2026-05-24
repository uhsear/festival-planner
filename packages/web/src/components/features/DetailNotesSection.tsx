interface Props {
  personalNote: string;
  crewNote: string;
  onPersonalChange: (value: string) => void;
  onCrewChange: (value: string) => void;
}

export default function DetailNotesSection({
  personalNote, crewNote, onPersonalChange, onCrewChange,
}: Props) {
  return (
    <div>
      <div className="text-xs font-bold text-text-secondary mb-2.5 uppercase tracking-[1px]" id="notes-label">
        Personal Notes
      </div>
      <textarea
        placeholder='Add notes (e.g., "meet at the rail")...'
        aria-labelledby="notes-label"
        className="w-full min-h-[80px] resize-y text-sm p-3 rounded-sm bg-bg-input border border-border-light text-text-primary"
        value={personalNote}
        onChange={(e) => onPersonalChange(e.target.value)}
      />

      <div className="mt-2">
        <div
          className="text-xs font-bold text-accent-aqua mb-2.5 uppercase tracking-[1px]"
          id="crew-notes-label"
        >
          Crew Note (visible to your crew)
        </div>
        <textarea
          placeholder="Share a note with your crew..."
          aria-labelledby="crew-notes-label"
          className="w-full min-h-[80px] resize-y text-sm p-3 rounded-sm bg-bg-input border border-accent-aqua text-text-primary"
          value={crewNote}
          onChange={(e) => onCrewChange(e.target.value)}
        />
      </div>
    </div>
  );
}
