import React from 'react';
import { Share2 } from 'lucide-react';

interface GridStageHeaderProps {
  visibleStages: Array<{ id: string }>;
  gutterW: number;
  minColWidth: string;
  exporting: boolean;
  onExport: () => void;
  getStageColor: (id: string) => string | undefined;
  getStageName: (id: string) => string | undefined;
}

export default function GridStageHeader({
  visibleStages,
  gutterW,
  minColWidth,
  exporting,
  onExport,
  getStageColor,
  getStageName,
}: GridStageHeaderProps) {
  return (
    <div
      className="fk-grid__head"
      role="row"
      style={{
        gridTemplateColumns: `${gutterW}px repeat(${visibleStages.length}, minmax(${minColWidth}, 1fr))`,
      }}
    >
      <div role="columnheader" aria-label="Time" className="flex items-center justify-center">
        <button
          className="fk-grid__share-btn"
          onClick={onExport}
          title="Share grid"
          aria-label="Share grid as image"
          aria-busy={exporting ? 'true' : 'false'}
          disabled={exporting}
          type="button"
        >
          <Share2 size={14} aria-hidden="true" />
        </button>
      </div>
      {visibleStages.map((st) => {
        const c = getStageColor(st.id);
        return (
          <div
            key={st.id}
            className="fk-grid__col-head"
            role="columnheader"
            style={{ '--stage-c': c } as React.CSSProperties}
          >
            {getStageName(st.id)}
          </div>
        );
      })}
    </div>
  );
}
