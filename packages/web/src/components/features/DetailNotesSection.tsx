import React from 'react';

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
    <div className="detail-notes">
      <div className="detail-notes-title" id="notes-label">
        Personal Notes
      </div>
      <textarea
        placeholder='Add notes (e.g., "meet at the rail")...'
        aria-labelledby="notes-label"
        value={personalNote}
        onChange={(e) => onPersonalChange(e.target.value)}
      />

      <div className="detail-notes" style={{ marginTop: '8px' }}>
        <div
          className="detail-notes-title"
          style={{ color: 'var(--accent-aqua)' }}
          id="crew-notes-label"
        >
          Crew Note (visible to your crew)
        </div>
        <textarea
          placeholder="Share a note with your crew..."
          aria-labelledby="crew-notes-label"
          style={{ borderColor: 'var(--accent-aqua)', borderWidth: '1px' }}
          value={crewNote}
          onChange={(e) => onCrewChange(e.target.value)}
        />
      </div>
    </div>
  );
}
