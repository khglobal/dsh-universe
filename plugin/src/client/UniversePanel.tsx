// The full-page panel (phase 1: the list view; the city drawing comes in phase 2). The top sentence, the today bar
// and the list all come from the same data at the same moment.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CITY_SOURCES, cityOfSource, type NeighbourId, type NeighbourSummary, type SourceId } from '@dsh-universe/adapter-dsh';
import { Region, SIGN, type CityId } from './Region.tsx';
import { hostDark } from './prefs.ts';
import { LAYER_OF_TODAY, buildingOf, historyWindow, nextIndex, rally, seenKey, idxAt, type LayerId, type Today } from '@dsh-universe/model';
import { CityPanel, TOUR_BUILDING, type CityTarget } from './CityPanel.tsx';
import { LIST_CSS, btn, group, groupBtn, px } from './chrome.ts';
import { citiesFound, citiesShown, neighbourOn, offSources, readPrefs, writePrefs, type Prefs } from './prefs.ts';
import { usePopover } from './popover.ts';
import { useFeed, useNow, useObservable } from './hooks.ts';
import { clock } from './format.ts';
import { unlockSound, useTime } from './time.ts';
import { QUIET, levelsOf, useAmbience, type CityLevels } from './sound.ts';
import './overlays.ts';
import { ListView, rowId } from './ListView.tsx';
import { S } from './styles.ts';
import { TodayBar } from './TodayBar.tsx';
import { Tour } from './Tour.tsx';
import { TOUR } from './tour.ts';
import type { Env } from './types.ts';
import { CITY, counts, headline, places, sections, todayAt, todayButtons, withLocal, type Row } from './view.ts';
import type { Store } from '@dsh-universe/model';
import type { Translate } from './types.ts';

/** The top sentence when looking back: what was going on at that moment. */
function pastHead(store: Store, T: number, t: Translate, lang: string): string {
  const { r, w } = counts(store, T);
  return t('h.past', { t: clock(T, lang), r, w });
}

const NO_DRAFTS_VIEW = { has: () => false };
const NO_DRAFTS = { getSnapshot: () => NO_DRAFTS_VIEW, subscribe: () => () => {} };

const EMPTY_PLACEMENT = { version: 1 as const, growth: 0, growthLog: [], claims: [], lots: {}, workspaces: {} };

const NO_TITLES: Record<string, string> = {};

export function UniversePanel({ env }: { env: Env }) {
  const [prefs, setPrefsState] = useState<Prefs>(() => readPrefs());
  const setPrefs = (p: Prefs) => { setPrefsState(p); writePrefs(p); };
  // Adjacent cities, one per vendor: which sources have a store on this device (folder presence only), which cities
  // are shown (any with a source the member left on), the city shown and whether the cities-around view is open.
  // Silent where nothing is found (a cloud workspace).
  const [present, setPresent] = useState<readonly SourceId[]>([]);
  useEffect(() => { let gone = false; env.neighbours?.detect().then((ids) => { if (!gone) setPresent(ids); }, () => undefined); return () => { gone = true; }; }, []);
  const found = citiesFound(present);
  const enabled = citiesShown(prefs, present);
  const off = offSources(prefs);
  const enabledKey = enabled.join(',') + '|' + off.join(',');
  // Their figures, every few seconds. Asked for only once the DSH city is up, so the host's reading of a large
  // store never delays it; the figures fill in as the reading goes on.
  const dsh = useFeed(env.feed);
  const dshUp = dsh.phase !== 'loading';
  const [sums, setSums] = useState<readonly NeighbourSummary[]>([]);
  useEffect(() => {
    const nb = env.neighbours;
    if (!nb || !enabled.length || !dshUp) { setSums([]); return; }
    let gone = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const s = await nb.summary(enabled, off).catch(() => [] as NeighbourSummary[]);
      if (gone) return;
      setSums(s);
      timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 300);
    return () => { gone = true; if (timer) clearTimeout(timer); };
  }, [enabledKey, dshUp]);
  const shownSums = sums.filter((x) => enabled.includes(x.id));
  // The first time a city's source is found: one line saying the city is shown, once per device.
  const [notice, setNotice] = useState<readonly NeighbourId[]>([]);
  useEffect(() => {
    const fresh = enabled.filter((id) => !prefs.noticed.includes(id));
    if (!fresh.length) return;
    setNotice(fresh);
    setPrefs({ ...prefs, noticed: [...prefs.noticed, ...fresh] });
  }, [present.join(',')]);
  const [activeChoice, setActive] = useState<CityId>('dsh');
  const active: CityId = activeChoice !== 'dsh' && enabled.includes(activeChoice) && env.neighbours ? activeChoice : 'dsh';
  const [regionOpen, setRegion] = useState(false);
  // Never stored: a reload always starts with it closed.
  const [settingsOpen, setSettings] = useState(false);
  const pop = usePopover<HTMLDivElement, HTMLButtonElement>(settingsOpen, setSettings);
  // The settings hang from their button's right edge; in a narrow panel (where the button is not at the right edge)
  // they are moved back inside the window.
  useLayoutEffect(() => {
    const el = pop.panel.current;
    if (!settingsOpen || !el) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect(), w = el.ownerDocument.documentElement.clientWidth;
    const dx = r.left < 12 ? 12 - r.left : r.right > w - 12 ? w - 12 - r.right : 0;
    if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`;
  });
  const feed = useFeed(active === 'dsh' ? env.feed : env.neighbours!.feed(active, off));
  const dshTitles = useObservable(env.titles);
  // An adjacent city's sessions carry their own label (a title the member set, or none): never DSH's list.
  const titles = active === 'dsh' ? dshTitles : NO_TITLES;
  const choose = (id: SourceId, on: boolean) => {
    const next = { ...prefs, neighbours: { ...prefs.neighbours, [id]: on } };
    setPrefs(next);
    if (!on) {
      env.neighbours?.stop(id);
      // The city's last source turned off: back to DSH.
      const city = cityOfSource(id);
      if (active === city && !citiesShown(next, present).includes(city)) setActive('dsh');
    }
  };
  const drafts = useObservable(env.drafts ?? NO_DRAFTS);
  const live = useNow(env.now);
  // The moment shown: live, looked back to on the timeline, or replayed (model/timeline).
  const time = useTime(live, feed.phase === 'ready' ? feed.store : undefined);
  const T = time.T;
  const [layer, setLayer] = useState<LayerId>('all');
  const [focus, setFocus] = useState<string | undefined>();
  const [cursor, setCursor] = useState<Record<string, number>>({});
  const [, setSeenTick] = useState(0);
  const [target, setTarget] = useState<CityTarget | undefined>();
  // The first-run tour: once per device (prefs `toured`), in the city view.
  const rootRef = useRef<HTMLDivElement>(null);
  const [tourAt, setTourAt] = useState(0);
  const [nIdx, setNIdx] = useState(-1);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const { t } = env;
  const lang = env.lang();

  const view = useMemo(() => {
    if (feed.phase !== 'ready' || !feed.platform) return undefined;
    const store = feed.store;
    const today = todayAt(store, T, CITY, env.seen, drafts);
    return {
      head: time.mode === 'live' ? headline(store, T, t) : pastHead(store, T, t, lang),
      today,
      // An adjacent city has no schedules: its button is left out rather than shown empty. In the DSH city, live, the
      // adjacent cities' sessions running, failed calls and tokens are added, labelled as local.
      buttons: ((b) => (active === 'dsh' && time.mode === 'live' ? withLocal(b, today, shownSums, t, lang) : b))(
        todayButtons(today, T, t, lang, feed.platform.caps).filter((b) => active === 'dsh' || b.cat !== 'sched' || feed.platform!.caps.schedules)),
      sections: sections(store, T, t, lang, titles, env.seen, drafts),
      places: places(store, T, t, lang, feed.platform.caps),
      schedules: feed.platform.caps.schedules ? store.schedules().slice().sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity)) : null,
      plugins: store.inventory().plugins,
      empty: !store.agents().some((s) => s.agent.startedAt <= T),
    };
    // feed.version changes whenever the store does (the city too: each city has its own feed and count).
  }, [feed.version, feed.phase, T, titles, lang, drafts, time.mode, active, shownSums]);
  // The DSH city's sessions running, for its chip while another city is shown.
  const dshRunning = useMemo(() => (dsh.phase === 'ready' ? todayAt(dsh.store, live, CITY).running : undefined), [dsh.version, dsh.phase, live]);
  // The ambience: the city in view, or in the cities-around view all of them from a distance (the focused card's
  // city brought forward). Each city's sound follows its own activity.
  const [regionFocus, setRegionFocus] = useState<CityId | undefined>();
  const levels = useMemo(() => {
    const out: Record<string, CityLevels> = {};
    if (view && feed.phase === 'ready') out[active] = levelsOf(feed.store, live, view.today.running, view.today.need);
    if (active !== 'dsh' && dsh.phase === 'ready') { const d = todayAt(dsh.store, live, CITY); out.dsh = levelsOf(dsh.store, live, d.running, d.need); }
    for (const x of shownSums) if (x.id !== active) out[x.id] = { ...QUIET, running: x.running, errors: Math.min(x.errors, 5), traffic: x.running * 4 };
    return out;
  }, [feed.version, dsh.version, Math.floor(live / 5000), active, shownSums]);
  const mix: Record<string, number> = regionOpen
    ? Object.fromEntries((['dsh', ...enabled] as CityId[]).map((id) => [id, regionFocus ? (id === regionFocus ? 0.8 : 0.12) : 0.3]))
    : { [active]: 1 };
  useAmbience(prefs.sound && prefs.view === 'city', time.mode === 'live', levels, mix);

  if (feed.phase !== 'ready' || !view) {
    const err = feed.phase === 'error';
    // Loading and errors: one calm card in the middle, the same chrome as the city.
    return (
      <div style={{ ...S.page, display: 'grid', placeItems: 'center' }}>
        <div role={err ? 'alert' : 'status'} style={{ ...px, maxWidth: 420, padding: '16px 18px' }}>
          <p style={{ ...S.head, margin: '0 0 6px' }}>{err ? t('h.error') : t('h.loading')}</p>
          <p style={{ ...S.note, margin: 0 }}>{err ? t('e.error') : t('e.backfill')}</p>
          {err && <button type="button" style={{ ...S.btn, marginTop: 12 }} onClick={() => (active === 'dsh' ? env.feed : env.neighbours!.feed(active, off)).retry()}>{t('e.retry')}</button>}
          {active !== 'dsh' && <button type="button" style={{ ...S.btn, marginTop: 12, marginLeft: 8 }} onClick={() => setActive('dsh')}>{t('nb.back')}</button>}
        </div>
      </div>
    );
  }

  // Into another city (a chip, or a figure only an adjacent city has).
  // Going to a city answers the one-line notice (it would otherwise hang over that city's rooms).
  const go = (id: CityId) => { setActive(id); setRegion(false); setRegionFocus(undefined); setNotice([]); setLayer('all'); setTarget(undefined); setFocus(undefined); };
  const press = (cat: keyof Today['items']) => {
    const items = view.today.items[cat];
    const i = nextIndex(cursor[cat] ?? -1, items.length);
    if (i < 0) {
      // Nothing of it in DSH, but in an adjacent city: go there (the one with the most).
      const k = cat === 'run' ? 'running' : cat === 'err' ? 'errors' : cat === 'tok' ? 'tokens' : undefined;
      const best = k && active === 'dsh' ? shownSums.filter((x) => x[k] > 0).sort((a, b) => b[k] - a[k])[0] : undefined;
      if (best) go(best.id);
      return;
    }
    setCursor({ ...cursor, [cat]: i });
    const id = cat === 'sched' ? 'sch:' + items[i] : items[i];
    setFocus(id);
    if (prefs.view === 'city') {
      // In the city: the button switches to its layer, and the camera goes to the thing (an agent in the square, a
      // building, a place).
      setLayer(LAYER_OF_TODAY[cat]);
      const s = feed.store.agent(items[i]);
      const where = cat === 'need' ? 'agent:' + items[i] : cat === 'sched' ? 'station' : s ? buildingOf(feed.store, s) : items[i];
      setTarget({ id: where, nonce: Date.now() });
    } else globalThis.document?.getElementById(rowId(id))?.scrollIntoView?.({ block: 'center' });
  };
  const markSeen = (row: Row) => {
    const s = feed.store.agent(row.id);
    if (s && env.seen.mark(seenKey(CITY, row.sessionId, idxAt(s, T)))) setSeenTick((x) => x + 1);
  };
  const rowFor = (sid: string) => view.sections.flatMap((x) => x.rows).find((r) => r.sessionId === sid);
  const open = active === 'dsh' && env.openSession && feed.platform?.caps.actions.openSession
    ? (row: Row) => { if (row.review) markSeen(row); env.openSession!(row.sessionId); }
    : undefined;

  const city = prefs.view === 'city';
  // Calm notes over the city (the list shows them in its own place): first run, partial history, storage, services.
  const notes = [
    view.empty && feed.backfill !== 'pending' ? 'e.empty' : '',
    feed.backfill === 'pending' ? (active === 'dsh' ? 'e.backfill' : 'nb.readingNote') : feed.backfill === 'partial' ? 'e.partial' : '',
    feed.full ? 'e.full' : '',
    feed.memoryOnly ? 'e.memory' : '',
    active === 'dsh' && feed.platform && !feed.platform.caps.schedules ? 'e.noSched' : '',
  ].filter((k) => k && !dismissed.has(k));
  const cityName = t('nb.city.' + active);
  // The adjacent cities' controls, beside the city / list switch: the sign of the city shown (once there is more
  // than one), and the settings with one switch per source found on this device, under its city.
  const nbControls = found.length > 0 && (
    <div style={{ position: 'relative', display: 'flex', gap: 8, alignItems: 'center' }} data-dshu-ctl="">
      {active !== 'dsh' && (
        <span data-dshu-sign={active} style={{ ...group, alignItems: 'center', gap: 6, padding: '3px 10px', fontSize: 12.5, fontWeight: 700 }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, background: SIGN[active], border: '2px solid #27304F' }} />
          {t('nb.cityOf', { name: cityName })}
        </span>
      )}
      <button ref={pop.trigger} type="button" aria-expanded={settingsOpen} aria-controls="dshu-nb-settings" style={groupBtn(settingsOpen)} onClick={() => setSettings(!settingsOpen)}>{t('nb.settings')}</button>
      {settingsOpen && (
        // Closes on its button, a click elsewhere, Esc or ×; a checkbox inside keeps it open.
        <div ref={pop.panel} id="dshu-nb-settings" role="dialog" aria-modal="false" aria-label={t('nb.settings')} data-dshu-nb-settings=""
          style={{ ...px, position: 'absolute', zIndex: 20, top: 36, right: 0, width: 300, maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box', padding: '10px 12px', fontSize: 12.5, lineHeight: '18px' }}>
          <button type="button" data-dshu-nb-close="" aria-label={t('card.close')} title={t('card.close')} onClick={() => pop.close()}
            style={{ ...btn, position: 'absolute', top: 4, right: 4, width: 28, height: 28, minHeight: 28, padding: 0, display: 'grid', placeItems: 'center' }}>×</button>
          {found.map((city) => (
            <fieldset key={city} data-dshu-nb-city={city} style={{ border: 0, margin: '0 0 6px', padding: 0, minWidth: 0 }}>
              <legend style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, marginBottom: 4, fontWeight: 700, paddingRight: 30 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, background: SIGN[city], border: '2px solid #27304F', flex: 'none' }} />
                {t('nb.cityOf', { name: t('nb.city.' + city) })}
              </legend>
              {CITY_SOURCES[city].filter((s) => present.includes(s)).map((id) => (
                <label key={id} data-dshu-nb-source={id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, margin: '0 0 4px 14px' }}>
                  <input type="checkbox" checked={neighbourOn(prefs, id)} onChange={(e) => choose(id, e.currentTarget.checked)} />
                  {t('nb.toggle', { name: t('nb.src.' + id) })}
                </label>
              ))}
            </fieldset>
          ))}
          <p style={{ ...S.note, margin: '6px 0 0' }}>{t('nb.reads')}</p>
          <p style={{ ...S.note, margin: '4px 0 0' }}>{t('nb.undo')}</p>
        </div>
      )}
    </div>
  );
  // Once per device, the first time a tool is found: one line saying its city is shown, and where to turn it off.
  const shownNotice = notice.filter((id) => enabled.includes(id));
  const noticeNames = shownNotice.map((id) => t('nb.city.' + id));
  const hintBar = shownNotice.length > 0 && (
    <div role="status" data-dshu-notice={shownNotice.join(' ')} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '4px 10px', ...px, boxShadow: 'none', fontSize: 12.5, maxWidth: 640 }}>
      <span style={{ flex: '1 1 220px' }}>{t('nb.found', { name: noticeNames.length > 1 ? t('nb.and', { a: noticeNames.slice(0, -1).join(t('nb.comma')), b: noticeNames[noticeNames.length - 1] }) : noticeNames[0] })}</span>
      <button type="button" style={{ ...S.btn, minHeight: 26, padding: '0 8px' }} onClick={() => { setSettings(true); setNotice([]); }}>{t('nb.settings')}</button>
      <button type="button" style={{ ...S.btn, minHeight: 26, padding: '0 8px' }} onClick={() => setNotice([])}>{t('e.dismiss')}</button>
    </div>
  );
  // A small chip for each other city with its sessions running, at the end of the toolbar under the zoom column:
  // shows the neighbours exist; a click goes there.
  const chips = enabled.length > 0 && (
    <div role="group" aria-label={t('nb.region')} data-dshu-chips="" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {(['dsh', ...enabled] as CityId[]).filter((id) => id !== active).map((id) => {
        const sm = id === 'dsh' ? undefined : shownSums.find((x) => x.id === id);
        const n = id === 'dsh' ? dshRunning : sm?.running;
        const name = t('nb.city.' + id);
        const text = n === undefined || (sm && !sm.ready && !n) ? t('nb.chipReading', { name }) : t('nb.chip', { name, n });
        return (
          <button key={id} type="button" data-dshu-chip={id} title={t('nb.enter', { name })} onClick={() => go(id)}
            style={{ ...btn, ...px, display: 'inline-flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, background: SIGN[id], border: '2px solid #27304F' }} />
            {text}
          </button>
        );
      })}
    </div>
  );
  const toggle = (
    <div role="group" aria-label={t('view.label')} data-dshu-ctl="" style={group}>
      {(['city', 'list'] as const).map((v) => (
        <button key={v} type="button" aria-pressed={prefs.view === v}
          style={groupBtn(prefs.view === v)}
          onClick={() => setPrefs({ ...prefs, view: v })}>{t('view.' + v)}</button>
      ))}
    </div>
  );
  const activeCat = layer === 'all' ? undefined : (Object.keys(LAYER_OF_TODAY) as (keyof typeof LAYER_OF_TODAY)[]).find((c) => LAYER_OF_TODAY[c] === layer);
  if (city) {
    return (
      <div ref={rootRef} style={{ ...S.page, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', position: 'relative' }}
        // A sound left on from an earlier visit starts with the member's first click (browsers need a gesture).
        onPointerDownCapture={() => { if (prefs.sound) unlockSound(); }}
        onKeyDown={(e) => {
          if ((e.key !== 'n' && e.key !== 'N') || /INPUT|TEXTAREA|SELECT/.test((e.target as Element).tagName)) return;
          const r = rally(feed.store, T);
          if (!r.length) return;
          const i = nextIndex(nIdx, r.length, e.key === 'n' ? 1 : -1);
          setNIdx(i);
          setTarget({ id: 'agent:' + r[i].agent.id, nonce: Date.now() });
        }}>
        {/* The toolbar sits above the city and the notes under it: the notes hang from its bottom edge (never at a fixed
            height, where a toolbar wrapped onto two lines went under them and its buttons could not be pressed). */}
        <div style={{ position: 'relative', zIndex: 11 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap-reverse', gap: 8, alignItems: 'flex-end', padding: '10px 12px 4px' }}>
            <p style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }} aria-live="polite">{view.empty ? t('h.empty') : view.head}</p>
            <div style={{ flex: '1 1 300px', minWidth: 0 }}>{regionOpen ? <p style={{ ...S.head, margin: '0 0 6px' }}>{t('nb.region')}</p> : <TodayBar buttons={view.buttons} t={t} onPress={press} oneRow active={activeCat} />}</div>
            <div style={{ marginLeft: 'auto', paddingBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>{nbControls}{toggle}</div>
          </div>
          {((hintBar && !regionOpen) || (notes.length > 0 && !regionOpen)) && (
            <div style={{ position: 'absolute', top: '100%', left: 12, right: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, pointerEvents: 'none' }}>
              {hintBar && !regionOpen && <div style={{ pointerEvents: 'auto', width: '100%', maxWidth: 640 }}>{hintBar}</div>}
              {notes.length > 0 && !regionOpen && (
                <div role="status" aria-label={t('e.notes')} style={{ pointerEvents: 'auto', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 10px', ...px, boxShadow: 'none', fontSize: 12.5, maxWidth: 640 }}>
                  <div style={{ flex: 1 }}>{notes.map((k) => <div key={k}>{t(k)}</div>)}</div>
                  <button type="button" style={{ ...S.btn, minHeight: 26, padding: '0 8px' }} onClick={() => setDismissed(new Set([...dismissed, ...notes]))}>{t('e.dismiss')}</button>
                </div>
              )}
            </div>
          )}
        </div>
        {regionOpen && enabled.length > 0 && env.neighbours ? (
          <Region t={t} lang={lang} now={live} dark={hostDark(rootRef.current)} active={active}
            cities={[{ id: 'dsh' as CityId, feed: env.feed }, ...enabled.map((id) => ({ id: id as CityId, feed: env.neighbours!.feed(id, off) }))]}
            onEnter={go} onClose={() => { setRegion(false); setRegionFocus(undefined); }} onFocusCity={setRegionFocus} />
        ) : <CityPanel key={active} onZoomOutFar={enabled.length > 0 ? () => setRegion(true) : undefined} beside={chips || undefined}
          hideLayers={active === 'dsh' ? undefined : [...(feed.platform?.caps.schedules ? [] : ['scheduled' as const]), ...(feed.platform?.caps.tokens ? [] : ['tokens' as const])]}
          t={t} lang={lang} T={T} store={feed.store} placement={feed.placement ?? EMPTY_PLACEMENT} titles={titles} version={feed.version}
          prefs={prefs} setPrefs={setPrefs} target={target} layer={layer} setLayer={setLayer} seen={env.seen} drafts={drafts}
          live={live} mode={time.mode} onScrub={time.scrub} onReplay={time.replay} onFollow={(id) => setTarget({ id: 'agent:' + id, nonce: Date.now() })} onOpen={open ? (sid) => { const r = rowFor(sid); if (r) open(r); else env.openSession?.(sid); } : undefined} caps={feed.platform?.caps} />}
        {!prefs.toured && active === 'dsh' && !regionOpen && <Tour t={t} root={rootRef} step={Math.min(tourAt, TOUR.length - 1)} onStep={(n) => {
          if (n === null) { setPrefs({ ...prefs, toured: true }); setTourAt(0); return; }
          setTourAt(n);
          // The square is in the city: the camera goes there.
          const id = TOUR[n].id;
          if (id === 'square') setTarget({ id: 'town', nonce: Date.now() });
          // A building: the running one nearest the square already on screen; the camera stays.
          if (id === 'building') setTarget({ id: TOUR_BUILDING, nonce: Date.now() });
        }} />}
      </div>
    );
  }
  return (
    // The list at most 960 px wide, centred (on a wide panel the action sat 600 px from its title).
    <div style={{ ...S.page, paddingInline: 'max(clamp(12px, 3vw, 32px), calc((100% - 960px) / 2))' }}>
      <style>{LIST_CSS}</style>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        {enabled.length > 0 && (
          // In the list, the cities are a choice in place of zooming out.
          <div role="group" aria-label={t('nb.region')} style={group}>
            {(['dsh', ...enabled] as CityId[]).map((id) => <button key={id} type="button" aria-pressed={active === id} style={groupBtn(active === id)} onClick={() => setActive(id)}>{t('nb.city.' + id)}</button>)}
          </div>
        )}
        {nbControls}{toggle}
      </div>
      {hintBar && <div style={{ margin: '8px 0' }}>{hintBar}</div>}
      <p style={S.head} aria-live="polite">{view.empty ? t('h.empty') : view.head}</p>
      {view.empty && <p style={S.note}>{t('e.empty')}</p>}
      {feed.backfill === 'partial' && <p style={S.note}>{t('e.partial')}</p>}
      {feed.full && <p style={S.note}>{t('e.full')}</p>}
      <TodayBar buttons={view.buttons} t={t} onPress={press} chrome />
      <ListView t={t} lang={lang} T={T} sections={view.sections} places={view.places} schedules={view.schedules}
        plugins={view.plugins} days={historyWindow(feed.history, feed.store, T)} focus={focus} onOpen={open} onSeen={markSeen} />
    </div>
  );
}
