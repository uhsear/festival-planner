import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardTrap } from './useKeyboardTrap';
import { type RefObject } from 'react';

describe('useKeyboardTrap', () => {
  let container: HTMLDivElement;
  let btn1: HTMLButtonElement;
  let btn2: HTMLButtonElement;
  let btn3: HTMLButtonElement;
  let rafCallback: FrameRequestCallback | null;

  beforeEach(() => {
    rafCallback = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    // Build a container with focusable children
    container = document.createElement('div');
    btn1 = document.createElement('button');
    btn1.textContent = 'First';
    btn2 = document.createElement('button');
    btn2.textContent = 'Middle';
    btn3 = document.createElement('button');
    btn3.textContent = 'Last';
    container.appendChild(btn1);
    container.appendChild(btn2);
    container.appendChild(btn3);
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function makeRef(el: HTMLElement | null): RefObject<HTMLElement | null> {
    return { current: el };
  }

  function pressKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
    document.dispatchEvent(event);
    return event;
  }

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    const ref = makeRef(container);

    renderHook(() => useKeyboardTrap(ref, true, onClose));

    pressKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when inactive', () => {
    const onClose = vi.fn();
    const ref = makeRef(container);

    renderHook(() => useKeyboardTrap(ref, false, onClose));

    pressKey('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses first focusable element on activation', () => {
    const onClose = vi.fn();
    const ref = makeRef(container);

    renderHook(() => useKeyboardTrap(ref, true, onClose));

    // Flush the rAF that sets initial focus
    expect(rafCallback).not.toBeNull();
    rafCallback!(performance.now());

    expect(document.activeElement).toBe(btn1);
  });

  it('wraps Tab from last element to first', () => {
    const onClose = vi.fn();
    const ref = makeRef(container);

    renderHook(() => useKeyboardTrap(ref, true, onClose));

    // Focus the last button
    btn3.focus();
    expect(document.activeElement).toBe(btn3);

    // Press Tab (forward) — should wrap to first
    pressKey('Tab', { shiftKey: false });
    expect(document.activeElement).toBe(btn1);
  });

  it('wraps Shift+Tab from first element to last', () => {
    const onClose = vi.fn();
    const ref = makeRef(container);

    renderHook(() => useKeyboardTrap(ref, true, onClose));

    // Focus the first button
    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    // Press Shift+Tab — should wrap to last
    pressKey('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(btn3);
  });

  it('does not wrap Tab when focus is on a middle element', () => {
    const onClose = vi.fn();
    const ref = makeRef(container);

    renderHook(() => useKeyboardTrap(ref, true, onClose));

    // Focus the middle button
    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    // Tab should NOT wrap (only wraps at boundaries)
    pressKey('Tab');

    // Focus should still be on btn2 (the browser would normally move it,
    // but the hook only preventDefault+focus for boundary elements)
    expect(document.activeElement).toBe(btn2);
  });

  it('restores focus to previously-focused element on deactivation', () => {
    const onClose = vi.fn();
    const ref = makeRef(container);

    // Focus an element outside the trap before activation
    const outsideBtn = document.createElement('button');
    outsideBtn.textContent = 'Outside';
    document.body.appendChild(outsideBtn);
    outsideBtn.focus();
    expect(document.activeElement).toBe(outsideBtn);

    const { rerender } = renderHook(
      ({ active }) => useKeyboardTrap(ref, active, onClose),
      { initialProps: { active: true } },
    );

    // Flush rAF — focus moves into container
    rafCallback!(performance.now());
    expect(document.activeElement).toBe(btn1);

    // Deactivate — should restore focus
    rerender({ active: false });
    expect(document.activeElement).toBe(outsideBtn);
  });

  it('removes keydown listener on cleanup', () => {
    const onClose = vi.fn();
    const ref = makeRef(container);

    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useKeyboardTrap(ref, true, onClose));
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('does nothing on Tab when container has no focusable children', () => {
    const onClose = vi.fn();
    const emptyContainer = document.createElement('div');
    document.body.appendChild(emptyContainer);
    const ref = makeRef(emptyContainer);

    renderHook(() => useKeyboardTrap(ref, true, onClose));

    // Should not throw
    expect(() => pressKey('Tab')).not.toThrow();
  });

  it('does nothing on Tab when containerRef is null', () => {
    const onClose = vi.fn();
    const ref = makeRef(null);

    renderHook(() => useKeyboardTrap(ref, true, onClose));

    expect(() => pressKey('Tab')).not.toThrow();
  });

  it('excludes disabled controls from the focus trap boundaries', () => {
    const onClose = vi.fn();
    // Disable the last child → the last focusable becomes btn2, so a forward
    // Tab from btn2 must wrap to btn1 (not sit on the disabled btn3).
    btn3.disabled = true;
    const ref = makeRef(container);

    renderHook(() => useKeyboardTrap(ref, true, onClose));

    btn2.focus();
    pressKey('Tab', { shiftKey: false });
    expect(document.activeElement).toBe(btn1);
  });
});
