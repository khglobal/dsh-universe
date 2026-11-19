// The first-run tour's view: a small, still card in the hard-edged chrome beside what each step names, with a plain
// outline round it. Not modal (the panel stays usable); Esc or × ends it; focus goes to the card's main button, and
// back to the city when it ends. Nothing
// moves, with or without reduced motion. Shown once per device (prefs `toured`); the legend has a "show again" button.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { btn, px } from './chrome.ts';
import { C } from './styles.ts';
import { TOUR, tourStep, type TourAction } from './tour.ts';
import type { Translate } from './types.ts';

type Box = { x: number; y: number; w: number; h: number };
/** Gap between the building's card and the tour card, and the room the tour card needs below it. */
const TOUR_GAP = 12, TOUR_ROOM_BELOW = 200;
/** The ring goes under the place cards (CityPanel's cards are at z-index 5), so it never crosses their text. */
export const TOUR_RING_Z = 4;

/** Where a step's target is, relative to the panel root (DOM targets, or the anchors the city panel keeps). */
function targetBox(root: HTMLElement, i: number): Box | undefined {
  const s = TOUR[i];
  const sel = 'css' in s.target ? s.target.css : `[data-dshu-anchor="${s.target.city}"]`;
  const el = root.querySelector(sel);
  if (!el) return undefined;
  const r = el.getBoundingClientRect(), o = root.getBoundingClientRect();
  if (!r.width && !r.height) return undefined;
  return { x: Math.round(r.left - o.left), y: Math.round(r.top - o.top), w: Math.round(r.width), h: Math.round(r.height) };
}

/** A touch screen with no pointer that hovers: "point at a building" does not apply there. */
const touchOnly = () => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

export function Tour({ t, root, step, onStep }: { t: Translate; root: RefObject<HTMLElement | null>; step: number; onStep(next: number | null): void }) {
  const [box, setBox] = useState<Box | undefined>();
  const [note, setNote] = useState<Box | undefined>();
  // The city's zoom group: the card keeps clear of it on a narrow panel (#18: it covered + and − at 390 px).
  const [zoomBox, setZoomBox] = useState<Box | undefined>();
  // The card of the place the step opened (a building's), when one is open.
  const [placeCard, setPlaceCard] = useState<Box | undefined>();
  const [size, setSize] = useState({ w: 800, h: 600 });
  const main = useRef<HTMLButtonElement>(null);
  // The card's real height (its text wraps differently with each font and width), for keeping clear of the zoom group.
  const cardEl = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(150);
  useLayoutEffect(() => { const h = cardEl.current?.offsetHeight; if (h && Math.abs(h - cardH) > 1) setCardH(h); });
  const s = TOUR[step];
  // The target can move with the camera: looked up again twice a second while the card is open (no animation).
  useEffect(() => {
    const look = () => {
      const r = root.current; if (!r) return;
      setBox(targetBox(r, step));
      const c = r.querySelector('[data-dshu-card]')?.getBoundingClientRect(), o = r.getBoundingClientRect();
      setPlaceCard(c && c.height ? { x: Math.round(c.left - o.left), y: Math.round(c.top - o.top), w: Math.round(c.width), h: Math.round(c.height) } : undefined);
      const b = r.getBoundingClientRect(); setSize({ w: b.width, h: b.height });
      // The panel's own notes (first run, partial history…) stay readable: the card keeps clear of them.
      const n = r.querySelector('[role=status]')?.getBoundingClientRect();
      setNote(n && n.height ? { x: n.left - b.left, y: n.top - b.top, w: n.width, h: n.height } : undefined);
      const z = r.querySelector('[data-dshu-zoom]')?.getBoundingClientRect();
      setZoomBox(z && z.height ? { x: Math.round(z.left - b.left), y: Math.round(z.top - b.top), w: Math.round(z.width), h: Math.round(z.height) } : undefined);
    };
    look();
    const id = setInterval(look, 500);
    return () => clearInterval(id);
  }, [step]);
  useEffect(() => { main.current?.focus({ preventScroll: true }); }, [step]);
  // At the end (Got it, Skip, ×, Esc) focus goes back to the city, not to the page's body (#19). The "show again"
  // button that may have started the tour sits in the legend, which the restart closed.
  const act = (a: TourAction) => {
    const next = tourStep(step, a);
    onStep(next);
    if (next === null) requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="application"]')?.focus({ preventScroll: true }));
  };

  // The card sits below its target when the target is in the upper half, above it otherwise; always inside the panel.
  // A building's step: below the building's own card with a 12 px gap, or above the building when
  // there is less than 200 px below that card; never over either.
  // On a narrow panel the card is narrower than the room left of the zoom group (down to 220 px) when it would cover it.
  let W = Math.min(300, size.w - 24);
  const H = 150;
  let left = 12, top = 12;
  if (box && placeCard && s.id === 'building') {
    // On the building card's side, but never over the building itself.
    const cardLeft = placeCard.x + placeCard.w / 2 < box.x + box.w / 2;
    left = cardLeft ? Math.min(placeCard.x, box.x - 4 - W) : Math.max(placeCard.x, box.x + box.w + 4);
    left = Math.max(12, Math.min(size.w - W - 12, left));
    top = size.h - (placeCard.y + placeCard.h + TOUR_GAP) >= TOUR_ROOM_BELOW ? placeCard.y + placeCard.h + TOUR_GAP : Math.max(12, Math.min(box.y, placeCard.y) - H - TOUR_GAP);
  } else if (box) {
    left = Math.max(12, Math.min(size.w - W - 12, box.x + box.w / 2 - W / 2));
    top = box.y + box.h / 2 < size.h / 2 ? box.y + box.h + 12 : box.y - H - 12;
    top = Math.max(12, Math.min(size.h - H - 12, top));
  }
  if (s.id !== 'building' && note && left < note.x + note.w && left + W > note.x && top < note.y + note.h && top + H > note.y) top = Math.min(size.h - H - 12, note.y + note.h + 8);
  const overZoom = () => !!zoomBox && left + W > zoomBox.x - 8 && left < zoomBox.x + zoomBox.w + 8 && top < zoomBox.y + zoomBox.h + 8 && top + cardH + 8 > zoomBox.y;
  if (zoomBox && overZoom()) {
    // First to its left, narrower if need be; then above it (or below it) when the group lies in a wide row.
    W = Math.max(Math.min(W, 220), Math.min(W, zoomBox.x - 8 - 12));
    left = Math.max(12, Math.min(left, zoomBox.x - 8 - W));
    if (overZoom()) {
      const above = zoomBox.y - 8 - cardH, below = zoomBox.y + zoomBox.h + 8;
      if (above >= 12 && (!box || above >= box.y + box.h + 4 || box.y > zoomBox.y)) top = above;
      else if (below + cardH <= size.h - 12) top = below;
    }
  }
  const ring: CSSProperties | undefined = box && { position: 'absolute', left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8, border: '2px solid #F0A020', borderRadius: 6, boxShadow: '0 0 0 2px #141A30', pointerEvents: 'none', zIndex: TOUR_RING_Z };
  const id = 'dshu-tour-' + s.id;
  return (
    <>
      {ring && <div aria-hidden="true" data-dshu-tour-ring="" style={ring} />}
      <div ref={cardEl} role="dialog" aria-modal="false" aria-labelledby={id + '-t'} aria-describedby={id + '-x'} data-dshu-tour={s.id}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); act('close'); } }}
        style={{ ...px, position: 'absolute', left: Math.round(left), top: Math.round(top), width: W, boxSizing: 'border-box', padding: '12px 14px', zIndex: 21, color: C.text, fontSize: 13, lineHeight: '19px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <b id={id + '-t'} style={{ fontSize: 14 }}>{t(s.title)}</b>
          <span style={{ fontSize: 11.5, color: C.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{t('tour.count', { i: step + 1, n: TOUR.length })}</span>
        </div>
        <p id={id + '-x'} style={{ margin: '6px 0 10px', color: C.text }}>{t(s.id === 'building' && touchOnly() ? s.text + 'Touch' : s.text)}</p>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" style={{ ...btn, marginRight: 'auto', color: C.muted }} onClick={() => act('close')}>{t('tour.skip')}</button>
          {step > 0 && <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} onClick={() => act('back')}>{t('tour.back')}</button>}
          <button ref={main} type="button" style={{ ...btn, ...px, boxShadow: 'none', background: '#141A30', color: '#FFFFFF' }} onClick={() => act('next')}>
            {step + 1 >= TOUR.length ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </>
  );
}
