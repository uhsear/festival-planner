import { useCallback, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Encapsulates the grid-to-image export logic. Dynamically imports
 * html-to-image so the ~50 KB gzipped bundle only loads on demand.
 */
export function useGridExport(gridRef: RefObject<HTMLDivElement | null>, selectedDay: number, dayLabel: string) {
  const [exporting, setExporting] = useState(false);

  const exportGrid = useCallback(async () => {
    if (!gridRef.current || exporting) return;
    setExporting(true);
    // Normalize the resolved festival day label into a filename-safe slug for
    // the PNG name; the share title keeps the human-readable label.
    const daySlug =
      dayLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `day-${selectedDay + 1}`;
    const el = gridRef.current;
    const body = el.querySelector<HTMLElement>('[data-grid-body]');
    const cols = el.querySelector<HTMLElement>('[data-grid-cols]');
    const head = el.querySelector<HTMLElement>('[data-grid-head]');
    if (!body || !cols || !head) {
      setExporting(false);
      return;
    }

    const dpr = Math.min(Math.max(Math.ceil(window.devicePixelRatio || 1), 2), 3);
    const saved = {
      elOverflow: el.style.overflow,
      elHeight: el.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      bodyWidth: body.style.width,
      headWidth: head.style.width,
      colsMinWidth: cols.style.minWidth,
    };
    try {
      const gutterW = el.querySelector<HTMLElement>('[data-grid-gutter]')?.offsetWidth || 0;
      const fullW = Math.max(cols.scrollWidth + gutterW, el.clientWidth);
      const fullH = Math.max(cols.scrollHeight + head.offsetHeight, el.clientHeight);

      el.style.overflow = 'visible';
      el.style.height = fullH + 'px';
      body.style.overflow = 'visible';
      body.style.height = cols.scrollHeight + 'px';
      body.style.width = fullW + 'px';
      head.style.width = fullW + 'px';
      cols.style.minWidth = fullW - gutterW + 'px';

      await new Promise((r) => setTimeout(r, 50));
      if (document.fonts?.ready) await document.fonts.ready;

      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(el, {
        backgroundColor: '#080810',
        pixelRatio: dpr,
        width: fullW,
        height: fullH,
        cacheBust: true,
      });
      if (!blob) throw new Error('Capture failed');

      const filename = `festie-${daySlug}-grid.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${dayLabel} Grid` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: unknown) {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) console.error('Export failed', e);
    } finally {
      el.style.overflow = saved.elOverflow;
      el.style.height = saved.elHeight;
      body.style.overflow = saved.bodyOverflow;
      body.style.height = saved.bodyHeight;
      body.style.width = saved.bodyWidth;
      head.style.width = saved.headWidth;
      cols.style.minWidth = saved.colsMinWidth;
      setExporting(false);
    }
  }, [gridRef, selectedDay, dayLabel, exporting]);

  return { exporting, exportGrid };
}
