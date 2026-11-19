// A small popover beside its button (the nearby cities' settings): it closes on its button, a click anywhere else,
// Esc, or its own × button, and focus goes back to the button when it was closed from the keyboard or the ×. What
// happens inside it (a checkbox) never closes it. Open state is never stored: a reload always starts closed.
import { useEffect, useRef, type RefObject } from 'react';

/** Anything that can say whether it holds a node (a DOM element; tests pass plain objects). */
export interface Holder { contains(node: unknown): boolean }

/** A document event, reduced to what decides dismissal. */
export type DismissEvent = { type: 'pointerdown'; target: unknown } | { type: 'keydown'; key: string };

/**
 * What an event does to an open popover: `null` leaves it open; otherwise it closes, and `focusTrigger` says whether
 * focus goes back to its button (Esc; not a click elsewhere, which moves focus where the member clicked).
 * A press on the button itself is left to the button's own toggle.
 */
export function dismissal(e: DismissEvent, panel: Holder | null, trigger: Holder | null): { focusTrigger: boolean } | null {
  if (e.type === 'keydown') return e.key === 'Escape' ? { focusTrigger: true } : null;
  if (panel?.contains(e.target) || trigger?.contains(e.target)) return null;
  return { focusTrigger: false };
}

/**
 * Wires the dismissal of an open popover to the document. Returns the refs for the popover and its button, and
 * `close(focus)` for its × button.
 */
export function usePopover<P extends HTMLElement, B extends HTMLElement>(open: boolean, setOpen: (v: boolean) => void): {
  panel: RefObject<P>; trigger: RefObject<B>; close(focusTrigger?: boolean): void;
} {
  const panel = useRef<P>(null), trigger = useRef<B>(null);
  const close = (focusTrigger = true) => { setOpen(false); if (focusTrigger) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return;
    const doc = (trigger.current ?? panel.current)?.ownerDocument ?? globalThis.document;
    if (!doc) return;
    const on = (ev: Event) => {
      const d = ev.type === 'keydown' ? { type: 'keydown' as const, key: (ev as KeyboardEvent).key } : { type: 'pointerdown' as const, target: ev.composedPath?.()[0] ?? ev.target };
      const r = dismissal(d, panel.current, trigger.current);
      if (!r) return;
      if (d.type === 'keydown') { ev.preventDefault(); ev.stopPropagation(); }
      close(r.focusTrigger);
    };
    // The innermost target (composedPath), so a click inside a popover in a shadow root is still inside it.
    // Capture: the city's canvas and the host stop some events from bubbling; Esc closes the popover before anything
    // else backs out a step.
    doc.addEventListener('pointerdown', on, true);
    doc.addEventListener('keydown', on, true);
    return () => { doc.removeEventListener('pointerdown', on, true); doc.removeEventListener('keydown', on, true); };
  }, [open]);
  return { panel, trigger, close };
}
