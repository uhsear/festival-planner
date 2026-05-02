import React, { useState } from 'react';
import { Crew } from '@festie/shared/types';
import { ChevronDown, Plus, LogIn } from 'lucide-react';
import Button from '../ui/Button';
import { cn } from '@/lib/utils';
import { useHaptics } from '@/hooks/useHaptics';

interface CrewSelectorProps {
  crews: Crew[];
  selectedCrewId?: string;
  onSelectCrew: (crewId: string) => void;
  onCreateCrew: () => void;
  onJoinCrew: () => void;
}

export default function CrewSelector({
  crews,
  selectedCrewId,
  onSelectCrew,
  onCreateCrew,
  onJoinCrew,
}: CrewSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedCrew = crews.find((c) => c.id === selectedCrewId) || crews[0];
  const { tap, select } = useHaptics();

  return (
    <div className="relative">
      <button
        onClick={() => { tap(); setIsOpen(!isOpen); }}
        aria-label="Select crew"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && isOpen) {
            setIsOpen(false);
            e.stopPropagation();
          }
        }}
        className={cn(
          'w-full px-3 py-1.5 rounded-lg font-semibold text-sm transition-colors',
          'bg-bg-card border border-border text-text-primary',
          'hover:border-border-light flex items-center justify-between',
        )}
      >
        <span>{selectedCrew?.name || 'Select Crew'}</span>
        <ChevronDown
          className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Crew list"
          className={cn(
          'crew-selector-panel absolute top-full mt-1 left-0 right-0 z-50',
          'bg-bg-secondary border border-border rounded-lg overflow-hidden',
          'shadow-lg'
        )}>
          {crews.length > 0 && (
            <div
              className="max-h-48 overflow-y-auto"
              style={{ overscrollBehavior: 'contain' }}
            >
              {crews.map((crew) => (
                <button
                  key={crew.id}
                  role="option"
                  aria-selected={selectedCrewId === crew.id}
                  onClick={() => {
                    select();
                    onSelectCrew(crew.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'w-full px-4 py-2.5 text-left font-semibold transition-colors border-b border-border last:border-b-0',
                    selectedCrewId === crew.id
                      ? 'bg-accent-aqua/20 text-accent-aqua'
                      : 'text-text-primary hover:bg-bg-card',
                  )}
                >
                  {crew.name}
                  <span className="ml-2 text-xs text-text-muted">👥</span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-border p-1.5 space-y-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onCreateCrew();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 justify-center"
            >
              <Plus className="w-4 h-4" />
              Create Crew
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onJoinCrew();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 justify-center"
            >
              <LogIn className="w-4 h-4" />
              Join by Code
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
