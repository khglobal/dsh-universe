// The cities around: what the member sees when zooming out past the widest view of a city, once at least one
// adjacent city (Claude Code, Codex on this device) is turned on. Each city is a card with a clear sign, a still
// picture of the whole city and today's numbers; choosing one goes into it. The DSH city is always first.
import { useEffect, useMemo, useRef } from 'react';
import { emptyPlacement, todayAt } from '@dsh-universe/model';
import type { NeighbourId } from '@dsh-universe/adapter-dsh';
import type { Feed } from './feed.ts';
import { tokens } from './format.ts';
import { useFeed } from './hooks.ts';
import { CHROME_CSS, CHROME_ROOT, px } from './chrome.ts';
import { C, S } from './styles.ts';
import { TileCity } from './Tile.tsx';
import type { Translate } from './types.ts';
import { CITY } from './view.ts';

export type CityId = 'dsh' | NeighbourId;
/** The sign colour of each city (a band on its card; the name is always written beside it). */
export const SIGN: Record<CityId, string> = { dsh: '#2F6BDE', 'claude-code': '#C8643C', codex: '#14A8A4' };

export function Region({ cities, active, t, lang, now, dark, onEnter, onClose }: {
  cities: { id: CityId; feed: Feed }[]; active: CityId; t: Translate; lang: string; now: number; dark: boolean;
  onEnter(id: CityId): void; onClose(): void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return (
    <div className={CHROME_ROOT} role="region" aria-label={t('nb.region')} data-dshu-region=""
      onKeyDown={(e) => { if (e.key === 'Escape' || e.key === '+' || e.key === '=') { e.preventDefault(); onClose(); } }}
      onWheel={(e) => { if (e.deltaY < -40) onClose(); }}
      style={{ position: 'relative', flex: 1, minHeight: 320, overflow: 'auto', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <style>{CHROME_CSS}</style>
      <p style={{ ...S.note, margin: '0 0 12px' }}>{t('nb.regionHead')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
        {cities.map((c, i) => (
          <li key={c.id}><Card id={c.id} feed={c.feed} here={c.id === active} t={t} lang={lang} now={now} dark={dark} onEnter={onEnter} btnRef={i === 0 ? first : undefined} /></li>
        ))}
      </ul>
    </div>
  );
}

function Card({ id, feed, here, t, lang, now, dark, onEnter, btnRef }: {
  id: CityId; feed: Feed; here: boolean; t: Translate; lang: string; now: number; dark: boolean; onEnter(id: CityId): void; btnRef?: React.Ref<HTMLButtonElement>;
}) {
  const f = useFeed(feed);
  const ready = f.phase === 'ready';
  const T = Math.floor(now / 60_000) * 60_000;
  const d = useMemo(() => (ready ? todayAt(f.store, T, CITY) : undefined), [ready, f.version, T]);
  const name = t('nb.city.' + id);
  const stats = !ready ? (f.phase === 'error' ? t('h.error') : t('nb.reading', { name })) : d
    ? t('nb.stats', { r: d.running, e: d.errors, k: tokens(d.tokens, lang) })
    : '';
  return (
    <button ref={btnRef} type="button" data-dshu-city={id} aria-label={t('nb.enter', { name }) + (stats ? ' · ' + stats : '')} onClick={() => onEnter(id)}
      style={{ ...px, display: 'flex', flexDirection: 'column', width: '100%', padding: 0, font: 'inherit', color: C.text, textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}>
      {/* The sign: the city's name, large, on its colour band. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '2px solid #27304F' }}>
        <span aria-hidden="true" style={{ width: 14, height: 14, background: SIGN[id], border: '2px solid #27304F', flex: 'none' }} />
        <b style={{ fontSize: 16, letterSpacing: 0.2 }}>{name}</b>
        {here && <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>{t('nb.here')}</span>}
      </span>
      <span style={{ display: 'block', height: 180, position: 'relative' }}>
        {ready ? <TileCity store={f.store} placement={f.placement ?? emptyPlacement()} T={T} version={f.version} dark={dark} whole />
          : <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: C.muted, fontSize: 13 }}>{stats}</span>}
      </span>
      <span style={{ padding: '6px 12px', fontSize: 12.5, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{ready && !f.store.agents().length ? t('nb.none') : stats}</span>
    </button>
  );
}
