// The timeline dock: the clock and "live"; today's calls per
// ten minutes; waits (amber, taller when more wait at once: approvals, questions and plans; red: stops on an error); scheduled runs (solid:
// past, dashed: to come); a scrubber to look back (keyboard: one minute per press; past now returns to live); replay
// of the day; minimisable. Text on the canvas is drawn at screen resolution on whole pixels.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { binReadout, daySpan, dayStart, scrubTo, stepScrub, waitBands, type Store } from '@dsh-universe/model';
import { btn, px } from './chrome.ts';
import { clock } from './format.ts';
import { C } from './styles.ts';
import type { Translate } from './types.ts';

export type TimeMode = 'live' | 'past' | 'replay';
export interface TimelineProps {
  t: Translate; lang: string;
  /** The moment shown, and now. */
  T: number; live: number; mode: TimeMode;
  store: Store; version: number;
  min: boolean; onToggle(): void;
  /** null: back to live. */
  onScrub(T: number | null): void;
  onReplay(): void;
  /** A wait band was clicked: show that moment (null: live, for a wait still open) and follow the agent. */
  onBand?(agentId: string, T: number | null): void;
}

const HOUR = 3600_000;
const AMBER = '#F0A020', RED = '#E5564B', ACCENT = '#2F6BDE';

export function Timeline(p: TimelineProps) {
  const { t, lang, T, live, mode, store, min } = p;
  const ref = useRef<HTMLCanvasElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [from, to] = daySpan(store, live);
  // A mouse over the bars shows a plate above the pointer: the ten minutes, their calls, failed calls.
  const [peek, setPeek] = useState<{ x: number; at: number } | undefined>();

  useEffect(() => {
    const cv = ref.current;
    if (!cv || min) return;
    const dpr = globalThis.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    if (!r.width) return;
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    if (!g) return;
    const ink = getComputedStyle(cv).color || C.text;
    const rgb = (ink.match(/\d+/g) ?? ['20', '26', '48']).slice(0, 3).join(',');
    const w = r.width, h = r.height;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const X = (ms: number) => Math.round(10 + (ms - from) / (to - from) * (w - 20));
    const base = h - 20, top = 18;
    // What has not happened yet is shaded.
    g.fillStyle = `rgba(${rgb},.05)`; g.fillRect(X(live), 6, w - 10 - X(live), base - 6);
    // Calls per ten minutes: all calls light, edits and commands dark; dimmed after the moment shown.
    const bins = [...store.bins()].filter(([k]) => k >= from && k < to);
    const max = Math.max(4, ...bins.map(([, b]) => b.calls));
    const bw = Math.max(1, Math.floor((w - 20) * 600_000 / (to - from)) - 2);
    for (const [k, b] of bins) {
      const x = X(k) + 1, ha = Math.round((b.calls - b.work) / max * (base - top)), hb = Math.round(b.work / max * (base - top));
      g.globalAlpha = k <= T ? 1 : 0.32;
      g.fillStyle = `rgba(${rgb},.26)`; g.fillRect(x, base - ha - hb, bw, ha);
      g.fillStyle = `rgba(${rgb},.72)`; g.fillRect(x, base - hb, bw, hb);
    }
    g.globalAlpha = 1;
    // Waits along the top, as a step chart that stays readable from one session to hundreds: per pixel column, the
    // amber height is how many were waiting for the member then (approvals, questions, plans), 2–8 px; the red line
    // above marks error stops still in the square. A single short wait still shows at least 3 px wide.
    const bands = waitBands(store, live), cols = Math.max(1, Math.round(w - 20));
    const amber = new Uint16Array(cols + 1), red = new Uint8Array(cols + 1);
    for (const band of bands) {
      const a = Math.max(0, X(band.from) - 10), b = Math.min(cols, Math.max(a + 3, X(band.to) - 10));
      for (let c = a; c < b; c++) { if (band.kind === 'error') red[c] = 1; else amber[c]++; }
    }
    const peak = Math.max(1, ...amber);
    g.fillStyle = AMBER;
    for (let c = 0; c <= cols; c++) if (amber[c]) { const hh = 2 + Math.round(6 * (amber[c] - 1) / Math.max(1, peak - 1)); g.fillRect(10 + c, 14 - hh, 1, hh); }
    g.fillStyle = RED;
    for (let c = 0; c <= cols; c++) if (red[c]) g.fillRect(10 + c, 2, 1, 3);
    // Scheduled runs today: solid when past, dashed when to come.
    const marks: { at: number; fut: boolean }[] = [];
    for (const sc of store.schedules()) {
      for (const run of sc.runs) if (run.at >= from && run.at <= to) marks.push({ at: run.at, fut: run.at > live });
      if (sc.status === 'active' && sc.nextAt !== undefined && sc.nextAt >= from && sc.nextAt <= to && !sc.runs.some((x) => x.at === sc.nextAt)) marks.push({ at: sc.nextAt, fut: sc.nextAt > live });
    }
    g.lineWidth = 1.4;
    for (const m of marks) {
      const x = X(m.at) + 0.5;
      g.strokeStyle = m.fut ? ACCENT : `rgba(${rgb},.5)`;
      g.setLineDash(m.fut ? [3, 3] : []);
      g.beginPath(); g.moveTo(x, 16); g.lineTo(x, base); g.stroke();
      g.setLineDash([]);
      g.fillStyle = m.fut ? ACCENT : `rgba(${rgb},.55)`; g.fillRect(x - 3.5, 13, 6, 6);
    }
    // Hours.
    g.fillStyle = `rgba(${rgb},.6)`;
    g.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    // Hour labels that never touch: every 2 h, every 4 h below 520 px, and only 08, 14, 20 below 420 px.
    const stepH = w < 420 ? 6 : w < 520 ? 4 : 2, first = stepH === 6 ? 8 : 0;
    for (let hh = Math.ceil((from - dayStart(live)) / HOUR); dayStart(live) + hh * HOUR <= to; hh++) {
      if ((hh - first) % stepH) continue;
      const x = Math.round(Math.min(w - 22, Math.max(22, X(dayStart(live) + hh * HOUR))));
      g.fillText(clock(dayStart(live) + hh * HOUR, lang), x, h - 6);
    }
    // The moment shown.
    const x = X(T);
    g.fillStyle = `rgb(${rgb})`; g.fillRect(x - 1, 4, 2, base - 2); g.fillRect(x - 4, 2, 8, 6);
  }, [p.version, T, live, min, from, to, lang]);

  const fromInput = (v: number) => p.onScrub(scrubTo(v, live, from));
  // A press on a wait band (the top 16 px of the dock) picks that wait: its moment, and the agent in the square.
  const onPointerDown = (e: PointerEvent<HTMLInputElement>) => {
    if (!p.onBand) return;
    const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (y > 16) return;
    const X = (ms: number) => 10 + (ms - from) / (to - from) * (r.width - 20);
    const hit = waitBands(store, live).filter((b) => x >= X(b.from) - 3 && x <= Math.max(X(b.to), X(b.from) + 3) + 3)
      .sort((a, b) => (a.kind === 'error' ? 1 : 0) - (b.kind === 'error' ? 1 : 0) || b.from - a.from)[0];
    if (!hit) return;
    e.preventDefault();
    p.onBand(hit.agentId, hit.open ? null : Math.round((hit.from + hit.to) / 2));
  };
  const onPeek = (e: PointerEvent<HTMLInputElement>) => {
    if (e.pointerType === 'touch') return;
    const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left;
    const at = from + (x - 10) / Math.max(1, r.width - 20) * (to - from);
    setPeek(at >= from && at < to ? { x: (track.current?.offsetLeft ?? 0) + x, at } : undefined);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // w / W: the next / previous wait after (before) the moment shown, followed like a click on its band.
    if ((e.key === 'w' || e.key === 'W') && p.onBand) {
      const bands = waitBands(store, live), fwd = e.key === 'w';
      const mid = (b: (typeof bands)[number]) => (b.open ? live : (b.from + b.to) / 2);
      const pick = fwd ? bands.find((b) => mid(b) > T + 1000) : [...bands].reverse().find((b) => mid(b) < T - 1000);
      e.preventDefault();
      if (pick) p.onBand(pick.agentId, pick.open ? null : Math.round((pick.from + pick.to) / 2));
      return;
    }
    const next = stepScrub(mode === 'past' ? T : null, live, e.key, from);
    if (next === undefined) return;
    e.preventDefault();
    p.onScrub(next);
  };
  const liveDot = mode === 'live'
    ? <span style={{ display: 'inline-block', width: 8, height: 8, background: '#1F7A4D', marginRight: 6 }} />
    : <span style={{ display: 'inline-block', width: 8, height: 8, background: AMBER, marginRight: 6 }} />;
  const state = mode === 'live' ? t('tl.live') : mode === 'replay' ? t('tl.replaying') : t('tl.back');

  return (
    <div role="group" aria-label={t('tl.label')} style={{ position: 'absolute', left: 12, right: 12, bottom: 10, display: 'flex', gap: 8, alignItems: 'stretch', zIndex: 4 }}>
      <button type="button" onClick={() => p.onScrub(null)} aria-label={mode === 'live' ? t('tl.live') : t('tl.toLive')} title={mode === 'live' ? undefined : t('tl.toLive')}
        style={{ ...btn, ...px, padding: min ? '4px 12px' : '6px 12px', minWidth: min ? 0 : 92, display: 'flex', flexDirection: min ? 'row' : 'column', alignItems: min ? 'center' : 'flex-start', justifyContent: 'center', gap: min ? 10 : 2, textAlign: 'left' }}>
        <b style={{ fontSize: min ? 14 : 18, lineHeight: min ? '22px' : '22px', fontVariantNumeric: 'tabular-nums' }}>{clock(T, lang)}</b>
        <span style={{ fontSize: 11.5, color: mode === 'live' ? C.muted : C.text, display: 'flex', alignItems: 'center', fontWeight: 500 }}>{liveDot}{state}</span>
      </button>
      {!min && (
        <div ref={track} style={{ ...px, flex: 1, minWidth: 0, height: 78, position: 'relative', overflow: 'hidden' }}>
          <canvas ref={ref} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', color: C.text }} />
          <input type="range" min={from} max={to} step={60_000} value={Math.min(to, Math.max(from, T))}
            aria-label={t('tl.scrub')} aria-valuetext={clock(T, lang) + (mode === 'live' ? ' · ' + t('tl.live') : '')}
            onChange={(e) => fromInput(Number(e.currentTarget.value))} onKeyDown={onKey} onPointerDown={onPointerDown}
            onPointerMove={onPeek} onPointerLeave={() => setPeek(undefined)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'ew-resize' }} />
        </div>
      )}
      {!min && peek && (() => {
        const r = binReadout(store, peek.at), W = 210;
        const left = Math.round(Math.max(0, Math.min((track.current?.offsetLeft ?? 0) + (track.current?.offsetWidth ?? W) - W, peek.x - W / 2)));
        return (
          <div aria-hidden="true" data-dshu-tl-peek="" style={{ ...px, position: 'absolute', left, bottom: '100%', marginBottom: 6, width: W, boxSizing: 'border-box', padding: '4px 8px', fontSize: 12, lineHeight: '16px', color: C.text, pointerEvents: 'none', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            <b>{clock(r.from, lang)}–{clock(r.to, lang)}</b>
            <div style={{ color: C.muted }}>{t('tl.peek', { n: r.calls, f: r.failed })}</div>
          </div>
        );
      })()}
      {min && <div style={{ flex: 1 }} />}
      <button type="button" aria-pressed={mode === 'replay'} aria-label={mode === 'replay' ? t('tl.stop') : t('tl.replay')} title={mode === 'replay' ? t('tl.stop') : t('tl.replay')}
        onClick={p.onReplay} style={{ ...btn, ...px, width: min ? 40 : 48, display: 'grid', placeItems: 'center' }}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          {mode === 'replay'
            ? <rect x="6" y="6" width="8" height="8" fill="currentColor" />
            : <><path d="M4 10a6 6 0 1 0 2-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" /><path d="M3.5 3v3.5H7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" /><path d="M8.6 7.6v4.8l4-2.4z" fill="currentColor" /></>}
        </svg>
      </button>
      <button type="button" aria-expanded={!min} aria-label={t(min ? 'tl.max' : 'tl.min')} title={t(min ? 'tl.max' : 'tl.min')} style={{ ...btn, ...px, width: 40 }} onClick={p.onToggle}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: min ? 'rotate(180deg)' : undefined }}><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
      </button>
    </div>
  );
}
