// The city in the `main` slot: the pixel city on a canvas, name plates and a hover card as real
// (focusable, readable) DOM over it, a toolbar with the layer buttons, a legend that starts closed, zoom buttons
// and a timeline that can be minimised. Titles appear only here, in the DOM, never in the pixels.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { CALLS_PER_CAR, LAYERS, PLACE, buildingOf, type Drafts, type LayerId, type PlacementState, type Seen, type Store, type UCapabilities } from '@dsh-universe/model';
import { CityView, artXY, shortTool } from '@dsh-universe/renderer';
import { Timeline, type TimeMode } from './Timeline.tsx';
import { unlockSound } from './time.ts';
import { CHROME_CSS, CHROME_ROOT, btn, pressed, px } from './chrome.ts';
import { overlayFactories, placeViewFor } from './extensions.ts';
import { makeKit } from './kit.ts';
import { onRatioChange, useEdgeFade } from './hooks.ts';
import { hostDark, isNight, nextLight, type Prefs } from './prefs.ts';
import { C, stateColor } from './styles.ts';
import type { Translate } from './types.ts';
import { CITY, layerSummary, placeName, rowOf } from './view.ts';

/** How far the city moves at once during a replay. */
export const REPLAY_CITY_STEP_MS = 15 * 60_000;

/**
 * Centre on this place or agent and open its card. `TOUR_BUILDING` (the tour's last step) instead opens the card of
 * the running building nearest the square among those on screen, without moving the camera.
 */
export interface CityTarget { id: string; nonce: number }
export const TOUR_BUILDING = 'tour:building';
/** A name plate's widest (the English waiting line, `13 min · waiting for approval execute_write`). */
const PLATE_W = 260;
/** The timeline's marks in the legend, drawn as Timeline.tsx draws them: the red line, an amber tick, a bar's dark part, the dotted blue line. */
const TL_KEY: readonly (readonly [string, CSSProperties])[] = [
  ['lg.tl.err', { width: 12, height: 3, background: '#E5564B' }],
  ['lg.tl.wait', { width: 3, height: 8, background: '#F0A020' }],
  ['lg.tl.work', { width: 7, height: 10, background: 'currentColor', opacity: 0.72 }],
  ['lg.tl.next', { width: 0, height: 12, borderLeft: '2px dashed #2F6BDE' }],
];
export interface CityProps {
  t: Translate; lang: string; T: number; store: Store; placement: PlacementState; titles: Record<string, string>;
  version: number; prefs: Prefs; setPrefs(p: Prefs): void;
  /** Centre on this place or agent (from the today bar or `n`). */
  target?: CityTarget;
  onOpen?(sessionId: string): void;
  /** The layer shown (the today bar switches it too). */
  layer: LayerId;
  setLayer(l: LayerId): void;
  /** For the "to review" layer. */
  seen?: Seen;
  drafts?: Drafts;
  /** The timeline: now, whether T is live, looked back to or replayed, and how to change it. */
  live: number;
  mode: TimeMode;
  onScrub(T: number | null): void;
  onReplay(): void;
  /** Follow an agent (a wait band on the timeline). */
  onFollow?(agentId: string): void;
  /** What the platform provides (passed on to place views). */
  caps?: UCapabilities;
  /** Zooming out past the widest view shows the cities around (only when an adjacent city is turned on). */
  onZoomOutFar?(): void;
  /** At the end of the toolbar, under the zoom column: the chips of the cities around. */
  beside?: ReactNode;
  /** Data views with nothing to show on this platform (an adjacent city without schedules): not offered. */
  hideLayers?: readonly LayerId[];
}

const LAYER_KEY: Record<LayerId, string> = { all: 'ly.all', scheduled: 'ly.scheduled', running: 'ly.running', review: 'ly.review', errors: 'ly.errors', tokens: 'ly.tokens', calls: 'ly.calls' };


interface Plate { id: string; sessionId: string; x: number; y: number; title: string; sub: string; state: string; /** A leader from the plate down to the placard: x, from y, to y. */ leader?: [number, number, number];
  /** A thin line from the plate's side to its agent: x0, y0, x1, y1. */ link?: [number, number, number, number] }

export function CityPanel(p: CityProps) {
  const { t, lang, T, store, placement, titles } = p;
  const wrap = useRef<HTMLDivElement>(null);
  // Day or night (the toolbar's choice; auto follows the host's theme), read by the resize handler too.
  const lightRef = useRef(p.prefs.light);
  lightRef.current = p.prefs.light;
  useEffect(() => { viewRef.current?.setDark(isNight(p.prefs.light, hostDark(wrap.current))); }, [p.prefs.light]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<CityView | null>(null);
  const [frame, setFrame] = useState(0);
  const { layer, setLayer } = p;
  /** The square (the balloon and the crowd) and a building (the one the tour moved to, or the first on screen). */
  const tourAnchors = (): { id: string; x: number; y: number; w: number; h: number }[] => {
    const v = viewRef.current;
    if (!v?.scene || !v.last) return [];
    const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
    // The square: everyone waiting there (heads and placards) and the balloon over them; the hall when nobody waits.
    const pts = v.scene.agents.filter((a) => a.inSquare).map((a) => v.last!.heads.get(a.id)).filter((q): q is [number, number] => !!q);
    const town = v.last.tops.get('town');
    if (pts.length) {
      const sc = pts.map((q) => v.screenOf(q[0], q[1]));
      const x0 = Math.min(...sc.map((q) => q[0])) - 24, x1 = Math.max(...sc.map((q) => q[0])) + 24, y0 = Math.min(...sc.map((q) => q[1])) - 70, y1 = Math.max(...sc.map((q) => q[1])) + 30;
      out.push({ id: 'square', x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) });
    } else if (town) { const [x, y] = v.screenOf(town[0], town[1]); out.push({ id: 'square', x: Math.round(x - 70), y: Math.round(y - 10), w: 140, h: 120 }); }
    const id = selected?.startsWith('b:') ? selected : p.target?.id.startsWith('b:') ? p.target.id : v.scene.places.find((q) => q.tier === 'building' && v.last!.tops.has(q.id))?.id;
    const top = id ? v.last.tops.get(id) : undefined;
    if (top) { const [x, y] = v.screenOf(top[0], top[1]); out.push({ id: 'building', x: Math.round(x - 30), y: Math.round(y - 6), w: 60, h: 90 }); }
    return out;
  };
  /**
   * The building the tour's last step points at: among those whose top is on screen (clear of the panel's edges), a
   * running one nearest the square; else one of today's sessions (any state), nearest the square; else any.
   */
  const tourBuilding = (v: CityView): string | undefined => {
    if (!v.scene || !v.last) return undefined;
    const sq = v.screenOf(...artXY(14.5, 18.6)), W = v.vp.w, H = v.vp.h;
    const rank = (q: { state?: string; sessionId?: string }) => (q.state === 'running' ? 0 : q.sessionId && store.agent(q.sessionId) ? 1 : 2);
    let best: [string, number, number] | undefined;
    for (const q of v.scene.places) {
      if (q.tier !== 'building') continue;
      const top = v.last.tops.get(q.id);
      if (!top) continue;
      const [x, y] = v.screenOf(top[0], top[1]);
      if (x < 40 || x > W - 40 || y < 70 || y > H - 200) continue;
      const r = rank(q), d = Math.hypot(x - sq[0], y - sq[1]);
      if (!best || r < best[1] || (r === best[1] && d < best[2])) best = [q.id, r, d];
    }
    return best?.[0];
  };
  // During a replay the city moves in steps of REPLAY_CITY_STEP_MS (the clock, the timeline and the today bar keep the
  // exact moment): each step rebuilds the still layer of the city, and doing that every frame cost 10–20 ms over a few
  // hundred sessions. Live and looking back, the city shows the exact moment.
  const cityT = p.mode === 'replay' ? Math.floor(T / REPLAY_CITY_STEP_MS) * REPLAY_CITY_STEP_MS : T;
  // Said once when the layer changes (not on every tick of the clock), for screen readers.
  const layerText = useMemo(() => layerSummary(layer, store, T, t, lang, p.seen, p.drafts), [layer, lang]);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  // The tour's building card goes on the side of the building away from the panel's centre.
  const [away, setAway] = useState(false);
  const [inside, setInside] = useState<string | undefined>();
  useEffect(() => { viewRef.current?.setLayer(layer); }, [layer]);
  // No city text under the timeline (its height plus 10 px).
  useEffect(() => { viewRef.current?.setTextBottom(p.prefs.dockMin ? 50 : 110); }, [p.prefs.dockMin, frame === 0]);
  // Place names and plates are never written under a control over the city (a workspace name under the
  // toolbar at zoom 3): the toolbar's pieces, the legend, the zoom group, the today bar and the view switch, measured
  // twice a second (a change only repaints when a rectangle moved).
  useEffect(() => {
    const look = () => {
      const v = viewRef.current, cv = canvas.current, w = wrap.current;
      if (!v || !cv || !w) return;
      const o = cv.getBoundingClientRect(), root = w.parentElement ?? w;
      const els = [...(toolbarRef.current ? [...toolbarRef.current.children] : []), ...root.querySelectorAll('[data-dshu-today], [data-dshu-ctl]')];
      const rects: [number, number, number, number][] = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        rects.push([Math.floor(r.left - o.left) - 2, Math.floor(r.top - o.top) - 2, Math.ceil(r.right - o.left) + 2, Math.ceil(r.bottom - o.top) + 2]);
      }
      v.setTextAvoid(rects);
    };
    look();
    const id = setInterval(look, 500);
    return () => clearInterval(id);
  }, []);
  // While a place view covers the city, the city keeps its last frame and stops painting.
  useEffect(() => { const v = viewRef.current; if (!v) return; if (inside) v.stop(); else v.start(); }, [inside]);
  // The selected place keeps its ring while its card is open.
  useEffect(() => { if (!hover) viewRef.current?.setHover(selected); }, [selected, hover]);
  const kit = useMemo(makeKit, []);
  // The toolbar wraps on narrow screens (and grows with the legend): the zoom group and the plates keep above it.
  const toolbarRef = useRef<HTMLDivElement>(null);
  // The layer toolbar is one scrolling row: a fade where it is cut.
  const layersRef = useRef<HTMLDivElement>(null);
  const layersFade = useEdgeFade(layersRef);
  const [toolbarH, setToolbarH] = useState(40);
  useLayoutEffect(() => { const h = toolbarRef.current?.getBoundingClientRect().height; if (h && Math.abs(h - toolbarH) > 1) setToolbarH(Math.round(h)); });
  const drag = useRef<{ x: number; y: number; moved: number; id: number } | null>(null);
  const wheel = useRef(0);

  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    if (!el || !cv) return;
    const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    let last = 0;
    const view = new CityView({
      kit, canvas: cv, reducedMotion: () => !!mq?.matches,
      onFrame: () => { const n = performance.now(); if (n - last > 120) { last = n; setFrame((f) => f + 1); } },
    });
    viewRef.current = view;
    const fit = () => { const r = el.getBoundingClientRect(); view.resize(Math.max(1, r.width), Math.max(1, r.height), globalThis.devicePixelRatio || 1); view.setDark(isNight(lightRef.current, hostDark(el))); };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : undefined;
    ro?.observe(el);
    const offRatio = onRatioChange(fit);
    const offs = overlayFactories().map((f) => view.addOverlay(f({ t, lang })));
    view.start();
    (globalThis as { __dshuCity?: CityView }).__dshuCity = view;
    return () => { for (const off of offs) off(); ro?.disconnect(); offRatio(); view.stop(); viewRef.current = null; };
  }, [kit]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.setDark(isNight(p.prefs.light, hostDark(wrap.current)));
    // Live: T runs on with the clock between data updates (walkers move smoothly); looking back or replaying: it stays.
    view.setInput({ store, placement, T: cityT, live: p.mode === 'live', city: CITY, seen: p.seen, drafts: p.drafts, templateTags: kit.buildingTags, names: { town: t('pl.town'), station: t('pl.station'), fire: t('pl.fire'), school: t('pl.school'), library: t('pl.library'), defaultWorkspace: t('ws.default') } });
  }, [p.version, placement, cityT, lang, kit, p.drafts, p.mode]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v || !p.target) return;
    // The scene of a new moment may not be painted yet (under reduced motion a frame can be 500 ms away): keep
    // trying for a second and a half, then give up.
    if (p.target.id === TOUR_BUILDING) {
      const pick = tourBuilding(v);
      setSelected(pick); setAway(!!pick); v.setFollow(undefined);
      return;
    }
    setAway(false);
    const t0 = performance.now(), id0 = p.target.id;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const painted = () => !!v.scene && Math.abs(v.scene.T - T) < 2500;   // the frame shows the moment asked for
    const go = () => { if ((!painted() || !v.centreOn(id0)) && performance.now() - t0 < 1500) timer = setTimeout(go, 100); };
    v.invalidate();
    go();
    const id = p.target.id;
    setSelected(id.startsWith('b:') || id.startsWith('agent:') ? id : undefined);
    v.setFollow(id.startsWith('agent:') ? id.slice(6) : undefined);
    return () => { if (timer) clearTimeout(timer); };
  }, [p.target?.nonce]);

  const view = viewRef.current;
  const toSession = (id: string): string | undefined => {
    if (id.startsWith('agent:')) { const s = store.agent(id.slice(6)); return s ? buildingOf(store, s).slice(2) : undefined; }
    return id.startsWith('b:') ? id.slice(2) : undefined;
  };
  // An agent's card goes into its own building (the breadcrumb then names the building, not "own building").
  const enterId = (id: string): string => { const sid = id.startsWith('agent:') ? toSession(id) : undefined; return sid ? 'b:' + sid : id; };
  const rowFor = (sessionId: string) => { const s = store.agent(sessionId); return s ? rowOf(s, store, T, t, lang, titles, false) : undefined; };

  // Name plates: agents in the square, then waiting, failed and running towers (and the hovered one). They never
  // overlap each other, the balloon, the town-hall sign or the panel's own controls.
  const plates: Plate[] = [];
  let crowdBox: [number, number, number, number] | undefined;
  if (view?.scene && view.last) {
    const z = view.zoomValue(), W = view.vp.w, H = view.vp.h, whole = view.isWhole();
    const toolbarTop = H - (p.prefs.dockMin ? 52 : 112) - toolbarH - 4;
    const zoomH = p.onZoomOutFar ? 214 : 176;
    const blocked = (x: number, y: number) => y > toolbarTop || (x > W - 60 && y > toolbarTop - zoomH + 6);
    const taken: [number, number, number, number][] = [];
    const hits = (bx: readonly number[]) => taken.some((t2) => bx[0] < t2[2] && bx[2] > t2[0] && bx[1] < t2[3] && bx[3] > t2[1]);
    const textW = (s2: string) => [...s2].reduce((a2, ch) => a2 + (/[\u2e80-\uffff]/.test(ch) ? 12.5 : 6.8), 0);
    const sizeOf = (title: string, sub: string) => [Math.min(PLATE_W, 20 + Math.max(textW(title), textW(sub))), 36] as const;
    const inside = (bx: readonly number[]) => bx[0] >= 8 && bx[2] <= W - 8 && bx[1] >= 8 && bx[3] <= toolbarTop;
    taken.push([W - 64, toolbarTop - zoomH, W, toolbarTop]);   // the zoom group
    // The square must stay clear: keep out of the balloon and the hall's sign.
    {
      const k = z < 1 ? 2 : 1, q = artXY(14.5, 18.6), a2 = view.screenOf(q[0] - 9 * k, q[1] - 64 - 23 * k), b2 = view.screenOf(q[0] + 9 * k, q[1] - 64 - 3 * k);
      if (view.scene.rally) taken.push([a2[0] - 4, a2[1] - 4, b2[0] + 4, b2[1] + 4]);
      const hs2 = artXY(14.5, 16.25, 66), hq = view.screenOf(hs2[0], hs2[1]);
      taken.push([hq[0] - 46, hq[1] - 36, hq[0] + 46, hq[1] + 4]);
    }
    // Agents in the square first: waiting before stopped on an error. Hidden in the whole-city view, where the doubled
    // balloon speaks for them.
    // The crowd in the square stays clear: no plate is put over it (its people and placards, plus a margin).
    const sq = view.scene.agents.filter((x) => x.inSquare);
    const crowd: [number, number, number, number] | undefined = sq.reduce<[number, number, number, number] | undefined>((acc, a) => {
      const h2 = view.last!.heads.get(a.id);
      if (!h2) return acc;
      const [x0, y0] = view.screenOf(h2[0] - 12, h2[1] - 24), [x1, y1] = view.screenOf(h2[0] + 14, h2[1] + 24);
      return acc ? [Math.min(acc[0], x0), Math.min(acc[1], y0), Math.max(acc[2], x1), Math.max(acc[3], y1)] : [x0, y0, x1, y1];
    }, undefined);
    if (crowd) taken.push([crowd[0] - 6, crowd[1] - 6, crowd[2] + 6, crowd[3] + 6]);
    crowdBox = crowd;
    // Plates for the three who have waited longest (waiting before stopped on an error), in a column beside the crowd;
    // hovering a plate rings its agent. More than three: the balloon's count says how many (`?waits=20`).
    if (z > 1 && crowd) {
      const firstThree = sq.slice().sort((x, y) => (x.person.placard === 3 ? 1 : 0) - (y.person.placard === 3 ? 1 : 0)).slice(0, 3);
      let yCol = crowd[1];
      for (const a of firstThree) {
        const head = view.last.heads.get(a.id);
        const r = head ? rowFor(a.sessionId) : undefined;
        if (!head || !r) continue;
        const [sx, sy] = view.screenOf(head[0], head[1] - 6);
        if (blocked(sx, sy)) continue;
        const sub = r.detail || r.stateText, [w, h] = sizeOf(r.title, sub);
        const left: [number, number, number, number] = [crowd[0] - 14 - w, yCol, crowd[0] - 14, yCol + h];
        const right: [number, number, number, number] = [crowd[2] + 14, yCol, crowd[2] + 14 + w, yCol + h];
        const box = [left, right].find((c) => inside(c) && !hits(c));
        if (!box) continue;
        taken.push(box);
        yCol = box[3] + 6;
        plates.push({ id: 'agent:' + a.id, sessionId: a.sessionId, x: Math.round(box[0]), y: Math.round(box[1]), title: r.title, sub, state: r.state });
      }
    }
    const order = { waiting: 0, failed: 1, running: 2 } as Record<string, number>;
    const cands = view.scene.places.filter((x) => x.sessionId && (x.state === 'waiting' || x.state === 'failed' || x.state === 'running' || x.id === selected || x.id === hover?.id))
      .sort((a, b) => (order[a.state!] ?? 3) - (order[b.state!] ?? 3));
    const inSquare = new Set(plates.map((x) => x.sessionId));
    for (const pl of cands) {
      if (inSquare.has(pl.sessionId!) && pl.id !== hover?.id) continue;   // its agent in the square already says it
      if (z < 1 && pl.state !== 'waiting') continue;
      // The whole-city view shows no waiting or failed tower plates unless hovered or selected: the doubled balloon and
      // its count speak for them.
      if (whole && (pl.state === 'waiting' || pl.state === 'failed') && pl.id !== hover?.id && pl.id !== selected) continue;
      // A tower that stopped on an error long ago only gets a plate up close (its agent in the square has one while it matters).
      if (z < 3 && pl.state === 'failed' && pl.id !== hover?.id && pl.id !== selected) continue;
      if (z < 2 && pl.state === 'running' && pl.id !== hover?.id && pl.id !== selected) continue;
      const top = view.last.tops.get(pl.id);
      if (!top) continue;
      const [x, y] = view.screenOf(top[0], top[1] - 4);
      if (blocked(x, y)) continue;
      const r = rowFor(pl.sessionId!);
      if (!r) continue;
      const sub = pl.state === 'running' ? shortTool(r.detail.split(' · ').pop() ?? '') || r.stateText : r.stateText, [w, h] = sizeOf(r.title, sub);
      let box: [number, number, number, number] = [x - 6, y - 34, x - 6 + w, y - 34 + h];
      // Clamped into the canvas with an 8 px inset; a plate pushed far from its tower is not shown.
      const dx = Math.max(8 - box[0], Math.min(0, W - 8 - box[2])), dy = Math.max(8 - box[1], 0);
      if (Math.abs(dx) > w / 2 || dy > h) continue;
      box = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy];
      if (box[3] > toolbarTop) continue;
      if (hits(box) && pl.id !== hover?.id) continue;
      taken.push(box);
      plates.push({ id: pl.id, sessionId: pl.sessionId!, x: Math.round(box[0]), y: Math.round(box[1]), title: r.title, sub, state: pl.state! });
    }
  }
  void frame;

  const onPointerDown = (e: RPointerEvent) => { if ((e.target as Element).closest('button')) return; drag.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); };
  const local = (e: { clientX: number; clientY: number }) => { const r = wrap.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const onPointerMove = (e: RPointerEvent) => {
    const v = viewRef.current;
    if (!v) return;
    const d = drag.current;
    if (d && d.id === e.pointerId) { const dx = e.clientX - d.x, dy = e.clientY - d.y; d.moved += Math.abs(dx) + Math.abs(dy); d.x = e.clientX; d.y = e.clientY; v.panBy(dx, dy); return; }
    if (e.pointerType === 'touch') return;
    const [x, y] = local(e);
    const h = v.hitAt(x, y);
    const id = h?.id;
    v.setHover(id ? (id.startsWith('agent:') ? id.slice(6) : id) : selected);
    setHover(id ? { id: id.startsWith('agent:') ? 'b:' + (toSession(id) ?? '') : id, x, y } : undefined);
  };
  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved > 5) return;
    const v = viewRef.current;
    if (!v) return;
    const [x, y] = local(e);
    const h = v.hitAt(x, y);
    const sid = h ? toSession(h.id) : undefined;
    // A click on a building goes inside (phase 3); a click on a person selects its session.
    if (h && !h.id.startsWith('agent:') && placeViewFor(h.id)) { setSelected(h.id); setInside(h.id); return; }
    setSelected(sid ? 'b:' + sid : h && !h.id.startsWith('agent:') ? h.id : undefined);
    // A click on a person follows it (the camera glides after it while it walks); anywhere else stops following.
    v.setFollow(h?.id.startsWith('agent:') ? h.id.slice(6) : undefined);
  };
  /** One step out; past the widest view, the cities around (when there are any). */
  const zoomOut = (x?: number, y?: number) => {
    const v = viewRef.current;
    if (!v) return;
    if (p.onZoomOutFar && !v.canZoomOut()) { p.onZoomOutFar(); return; }
    v.zoom(-1, x, y);
  };
  const onWheel = (e: React.WheelEvent) => {
    wheel.current += e.deltaY;
    if (Math.abs(wheel.current) < 50) return;
    const [x, y] = local(e);
    if (wheel.current < 0) viewRef.current?.zoom(1, x, y); else zoomOut(x, y);
    wheel.current = 0;
  };
  const onKey = (e: React.KeyboardEvent) => {
    const v = viewRef.current;
    if (!v || e.target !== e.currentTarget) return;
    const k = e.key;
    if (k === 'ArrowLeft') v.panBy(60, 0); else if (k === 'ArrowRight') v.panBy(-60, 0); else if (k === 'ArrowUp') v.panBy(0, 60); else if (k === 'ArrowDown') v.panBy(0, -60);
    else if (k === '+' || k === '=') v.zoom(1); else if (k === '-') zoomOut(); else if (k === '0') v.home();
    else if (k === 'Enter' || k === ' ') {   // the thing in the middle of the view opens its card
      const h = v.hitAt(v.vp.w / 2, v.vp.h / 2);
      const sid = h ? toSession(h.id) : undefined;
      if (h) openCard(sid ? 'b:' + sid : h.id, e.currentTarget as HTMLElement);
    } else return;
    e.preventDefault();
  };

  // Esc backs out one step: the place view (it handles its own Esc first), the open card, then the hover.
  const cardRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const closeCard = () => { setSelected(undefined); const r = returnTo.current; returnTo.current = null; (r && r.isConnected ? r : wrap.current?.querySelector<HTMLElement>('[role="application"]'))?.focus(); };
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || inside) return;
    if (selected) { e.preventDefault(); closeCard(); }
    else if (hover) { setHover(undefined); viewRef.current?.setHover(undefined); }
  };
  /** Opens the card of a place from the keyboard (a name plate): focus moves into the card, and back on Esc. */
  const openCard = (id: string, from?: HTMLElement | null) => { returnTo.current = from ?? null; setSelected(id); requestAnimationFrame(() => cardRef.current?.querySelector<HTMLElement>('button')?.focus() ?? cardRef.current?.focus()); };

  const card = (() => {
    const id = selected ?? hover?.id;
    if (!id || !view) return undefined;
    const sid = toSession(id);
    const r = sid ? rowFor(sid) : undefined;
    const top = view.last?.tops.get(id) ?? (id.startsWith('agent:') ? view.last?.heads.get(id.slice(6)) : undefined);
    const at = top ? view.screenOf(top[0], top[1]) : [hover?.x ?? view.vp.w / 2, hover?.y ?? view.vp.h / 2];
    // Beside the thing, on whichever side has room; never under the toolbar and timeline at the bottom.
    const W = 244, H = 190, bottom = (p.prefs.dockMin ? 52 : 112) + 48;
    const right = away && selected === id ? at[0] >= view.vp.w / 2 && at[0] + 18 + W <= view.vp.w - 8 || at[0] - 18 - W < 8 : at[0] + 18 + W <= view.vp.w - 8;
    const pos = {
      x: Math.round(right ? at[0] + 18 : Math.max(8, at[0] - 18 - W)),
      y: Math.round(Math.max(8, Math.min(view.vp.h - bottom - H, at[1] - 20))),
      sticky: !!selected,
    };
    // A card never covers the crowd in the square: it opens left of the crowd, where the plates stand (right if no room).
    if (crowdBox && pos.x < crowdBox[2] + 6 && pos.x + W > crowdBox[0] - 6 && pos.y < crowdBox[3] + 6 && pos.y + H > crowdBox[1] - 6) {
      pos.x = Math.round(crowdBox[0] - 14 - W >= 8 ? crowdBox[0] - 14 - W : Math.min(view.vp.w - 8 - W, crowdBox[2] + 14));
      pos.y = Math.round(Math.max(8, Math.min(view.vp.h - bottom - H, crowdBox[1])));
    }
    if (r) return { ...pos, r, place: undefined };
    if (sid && placement.sizes?.[sid]) {   // a building of an earlier day: its title (read live) and how it ended
      const z = placement.sizes[sid];
      const date = z.started !== undefined ? new Intl.DateTimeFormat(lang, { month: '2-digit', day: '2-digit' }).format(new Date(z.started)) : '';
      return { ...pos, r: undefined, place: { id, name: titles[sid] || t('card.past'), inside: -1, sub: [t('st.' + z.state), date].filter(Boolean).join(' · ') } };
    }
    const pl = view.scene?.places.find((x) => x.id === id);
    if (!pl || pl.tier === 'building') return undefined;
    const name = id.startsWith('shop:') ? id.slice(5) : placeName(id, t, store);
    // The town hall holds no one: its card says how many wait in the square, as the balloon does.
    const sub = id === PLACE.town ? t('td.need', { n: view.scene?.rally ?? 0 }) : t('pl.in', { n: pl.inside });
    return { ...pos, r: undefined, place: { id, name, inside: pl.inside, sub } };
  })();

  return (
    <div ref={wrap} className={CHROME_ROOT} onKeyDown={onPanelKey} style={{ position: 'relative', flex: 1, minHeight: 320, overflow: 'hidden', color: C.text, userSelect: 'none' }}>
      <style>{CHROME_CSS}</style>
      <div tabIndex={0} role="application" aria-label={t('city.aria')} onKeyDown={onKey}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }} onPointerLeave={() => { viewRef.current?.setHover(selected); setHover(undefined); }} onWheel={onWheel}
        onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = e.currentTarget.matches(':focus-visible') ? 'inset 0 0 0 3px #2F6BDE' : 'none'; }} onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
        style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: hover ? 'pointer' : 'grab', outline: 'none' }}>
        <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }} />
      </div>
      {/* Places the first-run tour points at (square, a building): empty, invisible, following the camera. */}
      {!p.prefs.toured && tourAnchors().map((a) => <span key={a.id} data-dshu-anchor={a.id} aria-hidden="true" style={{ position: 'absolute', left: a.x, top: a.y, width: a.w, height: a.h, pointerEvents: 'none' }} />)}
      {plates.map((pl) => pl.leader && <span key={pl.id + '-l'} aria-hidden="true" style={{ position: 'absolute', left: pl.leader[0] - 1, top: pl.leader[1], width: 2, height: Math.max(0, pl.leader[2] - pl.leader[1]), background: '#27304F', pointerEvents: 'none' }} />)}
      {plates.filter((pl) => !card || (pl.id !== (selected ?? hover?.id) && pl.sessionId !== toSession(selected ?? hover?.id ?? ''))).map((pl) => (
        <button key={pl.id} type="button" aria-label={pl.title + ' · ' + pl.sub} aria-haspopup="dialog" onClick={(e) => openCard(pl.id, e.currentTarget)} onMouseEnter={() => viewRef.current?.setHover(pl.id.startsWith('agent:') ? pl.id.slice(6) : pl.id)} onFocus={() => viewRef.current?.setHover(pl.id.startsWith('agent:') ? pl.id.slice(6) : pl.id)}
          style={{ ...px, position: 'absolute', left: 0, top: 0, transform: `translate(${pl.x}px, ${pl.y}px)`, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '2px 8px', maxWidth: PLATE_W, font: 'inherit', fontSize: 12, lineHeight: '15px', textAlign: 'left', color: C.text, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <b style={{ maxWidth: PLATE_W - 20, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.title}</b>
          <span style={{ fontSize: 11, color: stateColor(pl.state), maxWidth: PLATE_W - 20, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.sub}</span>
        </button>
      ))}
      {card?.place && (
        <div ref={cardRef} data-dshu-card="" tabIndex={-1} role={card.sticky ? 'dialog' : 'tooltip'} aria-label={card.place.name} style={{ ...px, position: 'absolute', left: card.x, top: card.y, width: 220, padding: '10px 12px', fontSize: 12, lineHeight: '18px', pointerEvents: card.sticky ? 'auto' : 'none', zIndex: 5 }}>
          <b style={{ display: 'block', fontSize: 13 }}>{card.place.name}</b>
          <span style={{ color: C.muted }}>{card.place.sub}</span>
          {card.sticky && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {p.onOpen && card.place.inside < 0 && <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} onClick={() => p.onOpen!(card.place!.id.slice(2))}>{t('act.open')}</button>}
              {placeViewFor(card.place.id) && <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} onClick={() => setInside(card.place!.id)}>{t('act.enter')}</button>}
              <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} aria-label={t('card.close')} onClick={closeCard}>×</button>
            </div>
          )}
        </div>
      )}
      {card?.r && (
        <div ref={cardRef} data-dshu-card="" tabIndex={-1} role={card.sticky ? 'dialog' : 'tooltip'} aria-label={card.r.title} style={{ ...px, position: 'absolute', left: card.x, top: card.y, width: 236, padding: '10px 12px', fontSize: 12, lineHeight: '18px', pointerEvents: card.sticky ? 'auto' : 'none', zIndex: 5 }}>
          <b style={{ display: 'block', fontSize: 13 }}>{card.r.title}</b>
          <span style={{ color: stateColor(card.r.state), fontWeight: 600 }}>{card.r.stateText}</span>
          {card.r.detail && <div style={{ color: C.muted }}>{card.r.detail}</div>}
          {card.r.context && <div style={{ color: C.muted }}>{card.r.context}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}><span>{card.r.tokens}</span><span>{card.r.duration}</span></div>
          {card.sticky && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {p.onOpen && <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} onClick={() => p.onOpen!(card.r.sessionId)}>{card.r.waiting ? t('act.confirm') : t('act.open')}</button>}
              {selected && placeViewFor(selected) && <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} onClick={() => setInside(enterId(selected))}>{t('act.enter')}</button>}
              <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} aria-label={t('card.close')} onClick={closeCard}>×</button>
            </div>
          )}
        </div>
      )}
      <div ref={toolbarRef} style={{ position: 'absolute', left: 12, right: 12, bottom: p.prefs.dockMin ? 52 : 112, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <p aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{layerText}</p>
        <div ref={layersRef} role="group" aria-label={t('ly.label')} data-dshu-layers="" style={{ ...px, display: 'flex', alignItems: 'center', gap: 2, padding: 3, flexWrap: 'nowrap', overflowX: 'auto', maxWidth: '100%', scrollbarWidth: 'none', ...layersFade }}>
          <span style={{ fontSize: 12, color: C.muted, padding: '0 6px', flex: 'none' }}>{t('ly.label')}</span>
          {LAYERS.filter((l) => !p.hideLayers?.includes(l)).map((l) => <button key={l} type="button" aria-pressed={layer === l} style={{ ...btn, flex: 'none', whiteSpace: 'nowrap', ...(layer === l ? pressed : {}) }} onClick={() => setLayer(l)}>{t(LAYER_KEY[l])}</button>)}
        </div>
        <button type="button" aria-expanded={p.prefs.legend} aria-pressed={p.prefs.legend} style={{ ...btn, ...px, ...(p.prefs.legend ? pressed : {}) }} onClick={() => p.setPrefs({ ...p.prefs, legend: !p.prefs.legend })}>{t('lg.title')}</button>
        <button type="button" aria-pressed={p.prefs.sound} aria-describedby="dshu-snd-hint" title={t('snd.hint')} style={{ ...btn, ...px, ...(p.prefs.sound ? pressed : {}) }}
          onClick={() => { if (!p.prefs.sound) unlockSound(); p.setPrefs({ ...p.prefs, sound: !p.prefs.sound }); }}>{t('snd.label')}</button>
        {/* Day or night: auto follows the host's theme, then day, then night; kept per device. */}
        <button type="button" data-dshu-light={p.prefs.light} aria-label={t('dn.aria', { now: t('dn.' + p.prefs.light), next: t('dn.' + nextLight(p.prefs.light)) })} aria-describedby="dshu-dn-hint" title={t('dn.hint')}
          style={{ ...btn, ...px, display: 'inline-flex', alignItems: 'center', gap: 6, ...(p.prefs.light !== 'auto' ? pressed : {}) }}
          onClick={() => p.setPrefs({ ...p.prefs, light: nextLight(p.prefs.light) })}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
            {p.prefs.light === 'auto' && <><rect x="2" y="2" width="12" height="12" /><path d="M8 2v12h6V2z" fill="currentColor" stroke="none" /></>}
            {p.prefs.light === 'day' && <><rect x="5" y="5" width="6" height="6" /><path d="M8 0.5v2M8 13.5v2M0.5 8h2M13.5 8h2M2.5 2.5l1.5 1.5M12 12l1.5 1.5M2.5 13.5 4 12M12 4l1.5-1.5" /></>}
            {p.prefs.light === 'night' && <path d="M10 2H6v2H4v2H3v4h1v2h2v2h4v-1h2v-1h1v-1h1V9h-3v1H8V9H7V5h1V3h2z" fill="currentColor" stroke="none" />}
          </svg>
          {t('dn.' + p.prefs.light)}
        </button>
        <span id="dshu-dn-hint" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{t('dn.hint')}</span>
        <span id="dshu-snd-hint" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{t('snd.hint')}</span>
        {p.beside && <div style={{ marginLeft: 'auto' }}>{p.beside}</div>}
        {p.prefs.legend && (
          // In a data view the legend is that layer's explanation; clear of the zoom column on a phone.
          <div style={{ ...px, flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: '2px 14px', padding: '6px 12px', fontSize: 11.5, lineHeight: '17px', color: C.muted, maxWidth: 'min(680px, calc(100% - 56px))', boxSizing: 'border-box' }}>
            {layer !== 'all'
              ? <span style={{ color: C.text }}><b>{t(LAYER_KEY[layer])}</b> · {t('ov.' + layer, { n: CALLS_PER_CAR })}</span>
              : ['lg.1', 'lg.2', 'lg.3', 'lg.4', 'lg.5', 'lg.6'].map((k) => <span key={k}>{t(k, { n: CALLS_PER_CAR })}</span>)}
            {/* The timeline's four marks, each with its own swatch. */}
            <span data-dshu-legend-tl="" style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 12px' }}>
              <b style={{ color: C.text, fontWeight: 600 }}>{t('lg.tl')}</b>
              {TL_KEY.map(([k, sw]) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span aria-hidden="true" style={sw} />{t(k)}</span>)}
            </span>
            <button type="button" style={{ ...btn, minHeight: 22, padding: '0 6px', fontSize: 11.5, textDecoration: 'underline' }} onClick={() => p.setPrefs({ ...p.prefs, legend: false, toured: false })}>{t('tour.again')}</button>
          </div>
        )}
      </div>
      <div role="group" aria-label={t('zm.label')} data-dshu-ctl="" style={{ ...px, position: 'absolute', right: 12, bottom: (p.prefs.dockMin ? 52 : 112) + toolbarH + 8, display: 'flex', flexDirection: 'column', padding: 2, gap: 2 }}>
        {([['zm.in', () => viewRef.current?.zoom(1), 'M8 3v10M3 8h10'], ['zm.out', () => zoomOut(), 'M3 8h10'],
          ['zm.home', () => viewRef.current?.home(), 'M2.5 8.5 8 3l5.5 5.5M4.5 7v6.5h7V7'], ['zm.whole', () => viewRef.current?.whole(), 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10'],
          ...(p.onZoomOutFar ? [['nb.region', () => p.onZoomOutFar!(), 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z']] as const : [])] as const).map(([k, fn, d]) => (
          <button key={k} type="button" aria-label={t(k)} title={t(k)} onClick={fn}
            style={{ ...btn, width: 36, height: 36, minHeight: 36, padding: 0, display: 'grid', placeItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter"><path d={d} /></svg>
          </button>
        ))}
      </div>
      {inside && (() => {
        const V = placeViewFor(inside);
        // Transparent: the inside view paints its own backdrop and fades in over the city.
        return V ? <div style={{ position: 'absolute', inset: 0, zIndex: 8 }}>
          <V.Component placeId={inside} store={store} placement={placement} T={T} titles={titles} t={t} lang={lang} close={() => setInside(undefined)} onOpen={p.onOpen} caps={p.caps} light={p.prefs.light} />
        </div> : null;
      })()}
      <Timeline t={t} lang={lang} T={T} live={p.live} mode={p.mode} store={store} version={p.version} min={p.prefs.dockMin}
        onToggle={() => p.setPrefs({ ...p.prefs, dockMin: !p.prefs.dockMin })} onScrub={p.onScrub} onReplay={p.onReplay}
        onBand={(id, T) => { p.onScrub(T); p.onFollow?.(id); }} />
    </div>
  );
}

