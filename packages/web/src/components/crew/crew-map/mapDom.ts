// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import type { MutableRefObject } from 'react';
import { formatStaleness, type Coord } from '@festie/shared/utils';

// Shared types + injection-safe popup DOM helpers for the CrewMap per-concern
// hooks (crew-map/). Extracted verbatim from CrewMap.tsx so every marker layer
// builds popups the same way — via createElement + textContent, never setHTML.

// The subset of the maplibre-gl module we use. We load it via `.default` at
// runtime (CJS interop — the test mock returns `{ default: {...} }`), but the
// type-level default member doesn't exist, so model the constructors we touch.
export type MapLibre = {
  Map: typeof import('maplibre-gl').Map;
  Marker: typeof import('maplibre-gl').Marker;
  Popup: typeof import('maplibre-gl').Popup;
  NavigationControl: typeof import('maplibre-gl').NavigationControl;
  LngLatBounds: typeof import('maplibre-gl').LngLatBounds;
};

export type GlMap = import('maplibre-gl').Map;
export type GlMarker = import('maplibre-gl').Marker;
export type MapRefObject = MutableRefObject<GlMap | null>;
export type GlRefObject = MutableRefObject<MapLibre | null>;
export type MapStatus = 'pending' | 'ready' | 'error';

/** A live pursue target: a peer, the SOS, or a nearest-amenity pin. */
export interface PursueTarget {
  id: string;
  label: string;
  coord: Coord;
}

// Popups are built with DOM APIs (createElement + textContent) and handed to
// MapLibre via `setDOMContent`, so user/server text is never parsed as HTML —
// the browser escapes it for us.

/** A <strong> title element with text set safely via textContent. */
export function titleEl(text: string, className?: string): HTMLElement {
  const strong = document.createElement('strong');
  if (className) strong.className = className;
  strong.textContent = text;
  return strong;
}

/** A subtitle line: <span class="festie-map-sub">text</span> preceded by a <br/>. */
export function subEl(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'festie-map-sub';
  span.textContent = text;
  return span;
}

/** Assemble popup children into a container fragment-equivalent <div>. */
export function popupContent(nodes: (Node | null)[]): HTMLElement {
  const root = document.createElement('div');
  let first = true;
  for (const n of nodes) {
    if (!n) continue;
    if (!first) root.appendChild(document.createElement('br'));
    root.appendChild(n);
    first = false;
  }
  return root;
}

// "as of 5m ago" → "5m ago" so we can render the honest "Live · 5m ago" copy.
export function relAge(serverAt: string): string {
  return formatStaleness(serverAt).replace(/^as of /, '');
}
