// The first-run tour (pure; the view is Tour.tsx): four calm steps, shown once per device, each naming one part of
// the city panel. Words only from the locale tables.

export interface TourStep {
  id: 'today' | 'layers' | 'square' | 'building';
  /** Locale keys of the step's title and text. */
  title: string;
  text: string;
  /** What the step points at: a selector in the panel, or the square / a building in the city. */
  target: { css: string } | { city: 'square' | 'building' };
}

export const TOUR: readonly TourStep[] = [
  { id: 'today', title: 'tour.today.t', text: 'tour.today.x', target: { css: '[data-dshu-today]' } },
  { id: 'layers', title: 'tour.layers.t', text: 'tour.layers.x', target: { css: '[data-dshu-layers]' } },
  { id: 'square', title: 'tour.square.t', text: 'tour.square.x', target: { city: 'square' } },
  { id: 'building', title: 'tour.building.t', text: 'tour.building.x', target: { city: 'building' } },
];

export type TourAction = 'next' | 'back' | 'close';
/** The step after an action; `null` when the tour ends (finished or dismissed). */
export function tourStep(i: number, a: TourAction): number | null {
  if (a === 'close') return null;
  if (a === 'back') return Math.max(0, i - 1);
  return i + 1 >= TOUR.length ? null : i + 1;
}
