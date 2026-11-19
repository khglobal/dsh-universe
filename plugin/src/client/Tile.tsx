// The workbench tile (optional host workbench, `workbench.tile`): a tiny pixel city around the square and today's
// numbers, designed for each size the tile declares (4×2, 2×2, 4×1). The workbench hands a tile only
// `{ size, theme, reducedMotion }`; everything else comes from this plugin's own feed. A click opens the full panel.
//
// Cheap by design: the city is a still picture (no frame loop), painted into a small buffer only when the data or the
// minute changes, and only while the tile is on screen (IntersectionObserver): off screen it costs no GPU work at all.
// Its look follows the workbench skin through the skin's own tokens (3D, 90s web, glass), with plain fallbacks.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { emptyPlacement, type PlacementState, type Store } from '@dsh-universe/model';
import type { ArtKit } from '@dsh-universe/renderer';
import { layoutOf, paintTileCity } from './tile-city.ts';
import { clock } from './format.ts';
import { useFeed, useNow } from './hooks.ts';
import { makeKit } from './kit.ts';
import type { Env } from './types.ts';
import { CITY, headline, todayAt } from './view.ts';

export interface TileProps { size?: { w: number; h: number }; theme?: 'light' | 'dark'; reducedMotion?: boolean }

/** One art kit for every tile on the page (its sprite cache is shared; the panel keeps its own). */
let tileKit: ArtKit | undefined;
const kitOnce = () => (tileKit ??= makeKit());

/** The skin's tokens, with fallbacks for a host without them. */
const INK = 'var(--awb-ink, currentColor)', MUTED = 'var(--awb-muted, #6B7280)', WARN = 'var(--awb-warn, #B76E00)';


export function Tile({ env, size, theme, reducedMotion }: { env: Env } & TileProps) {
  const feed = useFeed(env.feed);
  const now = useNow(env.now);
  const { t } = env;
  const layout = layoutOf(size);
  const ready = feed.phase === 'ready';
  // The minute is enough for a tile (waits are told in minutes); finer would repaint for nothing.
  const T = Math.floor(now / 60_000) * 60_000;
  const d = useMemo(() => (ready ? todayAt(feed.store, now, CITY, env.seen, env.drafts?.getSnapshot()) : undefined), [ready, feed.version, Math.floor(now / 15_000)]);
  const lang = env.lang();

  const box: CSSProperties = {
    display: 'grid', width: '100%', height: '100%', minHeight: 0, boxSizing: 'border-box', margin: 0, padding: 0, border: 0,
    background: 'transparent', color: INK, font: 'inherit', textAlign: 'left', cursor: env.openPanel ? 'pointer' : 'default', gap: 12,
    gridTemplateColumns: layout === 'wide' ? 'minmax(0,1fr) 150px' : layout === 'strip' ? '132px minmax(0,1fr)' : '1fr',
    gridTemplateRows: layout === 'square' ? 'minmax(0,1fr) auto' : '1fr',
  };
  const open = () => env.openPanel?.();

  if (!ready || !d) {
    return <div data-dshu-tile={layout} style={{ ...box, display: 'flex', alignItems: 'center', color: MUTED, fontSize: 13 }}>{feed.phase === 'error' ? t('h.error') : t('h.loading')}</div>;
  }
  const stat = (n: number | string, label: string, warn = false, big = 22) => (
    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <b style={{ fontSize: big, lineHeight: `${big + 2}px`, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: warn && Number(n) > 0 ? WARN : INK }}>{n}</b>
      <span style={{ fontSize: 12, lineHeight: '16px', color: warn && Number(n) > 0 ? WARN : MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </span>
  );
  const city = <TileCity store={feed.store} placement={feed.placement ?? emptyPlacement()} T={T} version={feed.version} dark={theme === 'dark'} />;
  const label = headline(feed.store, now, t);

  return (
    <button type="button" data-dshu-tile={layout} data-reduced-motion={reducedMotion ? '' : undefined} onClick={open} aria-label={t('tile.open') + ' · ' + label} style={box}>
      {layout === 'wide' && <>
        {city}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, paddingTop: 2 }}>
          {/* No headline over the four numbers (it counted agents, "running" counts sessions); it stays the button's name. */}
          <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
            {stat(d.need, t('tile.need'), true)}
            {stat(d.running, t('tile.run'))}
            {stat(d.review, t('tile.review'))}
            {stat(d.errors, t('tile.err'))}
          </span>
          <span style={{ marginTop: 'auto', fontSize: 12, lineHeight: '16px', color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {d.next ? t('tile.next', { t: clock(d.next.at, lang) }) : t('tile.nosched')}
          </span>
        </span>
      </>}
      {layout === 'square' && <>
        {city}
        <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {stat(d.need, t('tile.need'), true, 20)}
          {stat(d.running, t('tile.run'), false, 20)}
        </span>
      </>}
      {layout === 'strip' && <>
        {city}
        <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, alignItems: 'center' }}>
          {stat(d.need, t('tile.need'), true, 20)}
          {stat(d.running, t('tile.run'), false, 20)}
          {stat(d.errors, t('tile.err'), false, 20)}
        </span>
      </>}
    </button>
  );
}

/**
 * The square and the blocks round it, at half size (one art pixel per two CSS pixels), still. Painted when the data
 * or the minute changes and the tile is visible; never in a frame loop.
 */
export function TileCity({ store, placement, T, version, dark, whole }: { store: Store; placement: PlacementState; T: number; version: number; dark: boolean; whole?: boolean }) {
  const wrap = useRef<HTMLSpanElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | undefined>();
  const painted = useRef('');

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => setVisible(es.some((e) => e.isIntersecting))) : undefined;
    if (io) io.observe(el); else setVisible(true);
    const fit = () => { const r = el.getBoundingClientRect(); setDims({ w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) }); };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : undefined;
    ro?.observe(el);
    return () => { io?.disconnect(); ro?.disconnect(); };
  }, []);

  useEffect(() => {
    const canvas = cv.current;
    if (!canvas || !dims || !visible) return;   // off screen: nothing is drawn (and nothing is asked of the GPU)
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    const key = [version, T, dark, dims.w, dims.h, dpr, whole].join('|');
    if (painted.current === key) return;
    painted.current = key;
    paintTileCity(canvas, kitOnce(), { store, placement, T, dark, w: dims.w, h: dims.h, dpr, whole });
  }, [visible, dims, version, T, dark, whole]);

  return (
    <span ref={wrap} aria-hidden="true" style={{
      position: 'relative', display: 'block', minWidth: 0, minHeight: 0, overflow: 'hidden',
      // The skin's plate radius and sunken bevel (90s web: square and bevelled; glass: round with a bright rim).
      borderRadius: 'max(0px, calc(var(--awb-r-plate, 14px) - 6px))', boxShadow: 'var(--awb-sh0, inset 0 0 0 1px rgb(127 127 127 / .25))',
      background: dark ? '#0A0F24' : '#EEF3FA', ...(whole ? { height: '100%' } : {}),
    }}>
      <canvas ref={cv} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }} />
    </span>
  );
}
