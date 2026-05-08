/**
 * Collapsible legend explaining timeline colour-coding and symbols.
 */
export default function TimelineLegend() {
  return (
    <details className="timeline-legend" aria-label="Timeline legend">
      <summary>Legend</summary>
      <ul className="timeline-legend-list">
        <li>
          <span className="legend-swatch bg-[var(--color-accent-coral,#ff6b6b)]" aria-hidden="true" />
          Must See (your pick)
        </li>
        <li>
          <span className="legend-swatch bg-[var(--color-accent-aqua,#00d4aa)]" aria-hidden="true" />
          Want to See (your pick)
        </li>
        <li>
          <span className="legend-swatch bg-[var(--color-accent-amber,#f59e0b)]" aria-hidden="true" />
          Maybe (your pick)
        </li>
        <li>
          <span className="legend-dot" aria-hidden="true" />
          Crew pick — a friend in your crew also picked this set
        </li>
        <li>
          <span aria-hidden="true">⚠</span>
          Schedule conflict with another of your picks
        </li>
        <li>
          <span className="legend-now-line" aria-hidden="true" />
          Current time
        </li>
      </ul>
    </details>
  );
}
