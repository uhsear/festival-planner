import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// --- Mocks ---
// Guard the maplibre-gl import: the component dynamic-import()s it inside an
// effect, and on the has-pins path that effect runs. We stub the GL library so
// no WebGL/canvas is ever touched in jsdom. The CSS side-import is stubbed too.
const mapInstances: Array<{ on: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }> = [];
vi.mock('maplibre-gl', () => {
  class Map {
    on = vi.fn();
    remove = vi.fn();
    addControl = vi.fn();
    fitBounds = vi.fn();
    constructor() {
      mapInstances.push(this as unknown as { on: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> });
    }
  }
  class Marker {
    setLngLat() {
      return this;
    }
    setPopup() {
      return this;
    }
    addTo() {
      return this;
    }
  }
  class Popup {
    setHTML() {
      return this;
    }
  }
  class NavigationControl {}
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  return { default: { Map, Marker, Popup, NavigationControl, LngLatBounds } };
});
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

// Drive pin-derivation deterministically: the real shared util is pure, but
// mocking it keeps this test focused on CrewMap's own branching (empty vs map).
const { extractMeetingPointPins } = vi.hoisted(() => ({ extractMeetingPointPins: vi.fn() }));
vi.mock('@festie/shared/utils', () => ({
  extractMeetingPointPins,
  extractStagePins: () => [],
  pinsCentroid: (pins: Array<{ latitude: number; longitude: number }>) =>
    pins.length ? { latitude: pins[0].latitude, longitude: pins[0].longitude } : null,
}));

vi.mock('lucide-react', () => ({
  MapPin: () => <span data-testid="map-pin-icon" />,
  AlertTriangle: () => <span data-testid="alert-icon" />,
}));

import CrewMap from './CrewMap';

const POINT_WITH_COORDS = {
  id: 'mp1',
  label: 'Main Gate',
  location: 'By the entrance',
  active: true,
  latitude: 41.88,
  longitude: -87.62,
};
const POINT_NO_COORDS = { id: 'mp2', label: 'Food court', location: 'Center', active: true };

beforeEach(() => {
  vi.clearAllMocks();
  mapInstances.length = 0;
});

describe('CrewMap', () => {
  it('renders the empty state when no points have coords', () => {
    // No coord-bearing points → util yields no pins.
    extractMeetingPointPins.mockReturnValue([]);
    render(<CrewMap meetingPoints={[POINT_NO_COORDS]} />);
    expect(screen.getByText('No mapped meeting points yet')).toBeInTheDocument();
    expect(screen.getByText(/add a location to a meeting point/i)).toBeInTheDocument();
    // It must NOT attempt to construct a GL map on the empty path.
    expect(mapInstances).toHaveLength(0);
  });

  it('surfaces the honest "stages aren\'t mapped" note in the empty state', () => {
    extractMeetingPointPins.mockReturnValue([]);
    render(<CrewMap meetingPoints={[]} />);
    expect(screen.getByText(/stage locations aren.t mapped yet/i)).toBeInTheDocument();
  });

  it('renders the map container (not the empty state) when at least one pin has coords', () => {
    extractMeetingPointPins.mockReturnValue([
      {
        id: 'mp1',
        kind: 'meeting-point',
        label: 'Main Gate',
        sublabel: 'By the entrance',
        latitude: 41.88,
        longitude: -87.62,
      },
    ]);
    render(<CrewMap meetingPoints={[POINT_WITH_COORDS]} />);
    expect(screen.queryByText('No mapped meeting points yet')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Crew meeting points map')).toBeInTheDocument();
    // Single-pin count copy.
    expect(screen.getByText(/1 mapped point/)).toBeInTheDocument();
  });

  it('derives pins from the provided meeting points via the shared util', () => {
    extractMeetingPointPins.mockReturnValue([]);
    render(<CrewMap meetingPoints={[POINT_WITH_COORDS, POINT_NO_COORDS]} />);
    expect(extractMeetingPointPins).toHaveBeenCalledWith([POINT_WITH_COORDS, POINT_NO_COORDS]);
  });
});
