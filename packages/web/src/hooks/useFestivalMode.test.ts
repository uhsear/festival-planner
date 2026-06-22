import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFestivalMode } from './useFestivalMode';

// Mock external dependencies
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// Festival store mock — returns `days`
let mockDays: Array<{ date?: string }> = [];
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: { days: typeof mockDays }) => unknown) =>
    selector({ days: mockDays }),
}));

// Festival mode store mock
let mockIsFestivalMode = false;
let mockManuallyDisabled = false;
const mockSetFestivalMode = vi.fn();
let mockIsTodayFestivalDay = false;

vi.mock('@festie/shared/stores/festivalModeStore', () => ({
  useFestivalModeStore: (
    selector: (s: {
      isFestivalMode: boolean;
      manuallyDisabled: boolean;
      setFestivalMode: typeof mockSetFestivalMode;
    }) => unknown,
  ) =>
    selector({
      isFestivalMode: mockIsFestivalMode,
      manuallyDisabled: mockManuallyDisabled,
      setFestivalMode: mockSetFestivalMode,
    }),
  isTodayFestivalDay: () => mockIsTodayFestivalDay,
}));

describe('useFestivalMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDays = [];
    mockIsFestivalMode = false;
    mockManuallyDisabled = false;
    mockIsTodayFestivalDay = false;
  });

  it('returns showDayBanner=false when today is not a festival day', () => {
    mockIsTodayFestivalDay = false;
    const { result } = renderHook(() => useFestivalMode('/'));
    expect(result.current.showDayBanner).toBe(false);
  });

  it('returns showDayBanner=true when today is a festival day but mode is off', () => {
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = false;
    const { result } = renderHook(() => useFestivalMode('/cards'));
    expect(result.current.showDayBanner).toBe(true);
  });

  it('returns showDayBanner=false when festival mode is on', () => {
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = true;
    const { result } = renderHook(() => useFestivalMode('/cards'));
    expect(result.current.showDayBanner).toBe(false);
  });

  it('returns showDayBanner=false on the /festival-mode route', () => {
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = false;
    const { result } = renderHook(() => useFestivalMode('/festival-mode'));
    expect(result.current.showDayBanner).toBe(false);
  });

  it('auto-enables festival mode when today is a festival day', () => {
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = false;
    mockManuallyDisabled = false;
    renderHook(() => useFestivalMode('/settings'));
    expect(mockSetFestivalMode).toHaveBeenCalledWith(true);
  });

  it('does not auto-enable when manually disabled', () => {
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = false;
    mockManuallyDisabled = true;
    renderHook(() => useFestivalMode('/'));
    expect(mockSetFestivalMode).not.toHaveBeenCalled();
  });

  it('navigates to /festival-mode from / on festival day', () => {
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = false;
    mockManuallyDisabled = false;
    renderHook(() => useFestivalMode('/'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/festival-mode' });
  });

  it('navigates to /festival-mode from /cards on festival day', () => {
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = false;
    mockManuallyDisabled = false;
    renderHook(() => useFestivalMode('/cards'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/festival-mode' });
  });

  it('does not navigate from non-root routes', () => {
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = false;
    mockManuallyDisabled = false;
    renderHook(() => useFestivalMode('/settings'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('still navigates from / even when festival mode is already on', () => {
    // The hook navigates to /festival-mode from / or /cards regardless of
    // whether fmOn is true — it only skips calling setFestivalMode(true).
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = true;
    mockManuallyDisabled = false;
    renderHook(() => useFestivalMode('/'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/festival-mode' });
  });

  it('does not call setFestivalMode when already on', () => {
    mockIsTodayFestivalDay = true;
    mockIsFestivalMode = true;
    mockManuallyDisabled = false;
    renderHook(() => useFestivalMode('/settings'));
    expect(mockSetFestivalMode).not.toHaveBeenCalled();
  });
});
