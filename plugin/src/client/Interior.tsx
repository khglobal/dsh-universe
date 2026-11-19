// Inside a place: one floor at a time as a square room, the whole building as a floor stack
// with a button per floor, a breadcrumb and a way back to the city. Hover cards show metadata only (title, state,
// tool, counts); the room itself never shows a title or any content. Registered as the panel's place view.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { stateAt, type FloorKind, type UCapabilities } from '@dsh-universe/model';
import { RoomView, defaultFloor, interiorOf, tokenRate, type Interior, type InteriorFloor } from '@dsh-universe/renderer';
import { btn, pressed, px } from './chrome.ts';
import type { PlaceViewProps } from './extensions.ts';
import { frameNotifier, onRatioChange } from './hooks.ts';
import { makeKit } from './kit.ts';
import { hostDark, isNight } from './prefs.ts';
import { C, stateColor } from './styles.ts';
import { placeName, rowOf } from './view.ts';

/** The cards' outer widths (content 248 / 236 px, 12 px padding and the 2 px frame on each side): kept inside the view. */
const PROP_CARD_OUTER = 248 + 24 + 4, AGENT_CARD_OUTER = 236 + 24 + 4;
import { floorLabel, floorValue, propLines, roomSummary, type PropId } from './interior-text.ts';

/** True in the dev page build (scripts/dev.mjs), false in the shipped plugin (plugin/scripts/build.mjs). */
declare const __DSHU_DEV__: boolean | undefined;

/** What the host provides when the panel does not say (everything; a missing source then shows zeros, not "—"). */
const ALL_CAPS: UCapabilities = {
  approvals: true, schedules: true, subagents: true, jobs: true, deliverables: true, skills: true, memory: false, tokens: true, cost: false, latency: true,
  sessionTitles: true, actions: { openSession: true, draftFollowUp: true },
};

export interface InteriorProps extends PlaceViewProps {
  /** Dev and mock mode (`?room=<id>`): show this room template on the floor it is made for. */
  previewRoom?: { floor: FloorKind; room: string };
  /** The floor to open on (default: the one with most people). */
  floor?: string;
}

/** Visually hidden, still read (a screen-reader-only line). */
const SR_ONLY: CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };
/** A transparent button over something drawn in the room (the canvas is not focusable; these are). */
const overlay: CSSProperties = { position: 'absolute', background: 'transparent', border: 0, padding: 0, borderRadius: 4, zIndex: 2, outlineOffset: 2 };


export function InteriorView(p: InteriorProps & { caps?: UCapabilities }) {
  const { t, lang, T, store, placement, placeId, titles } = p;
  // Back to the city: the room fades out first (at once under reduced motion).
  const close = () => { const v = viewRef.current; if (v) v.leave(p.close); else p.close(); };
  const wrap = useRef<HTMLDivElement>(null);
  // Rooms follow the city's day or night.
  const lightRef = useRef(p.light);
  lightRef.current = p.light;
  useEffect(() => { viewRef.current?.setDark(isNight(p.light, hostDark(wrap.current))); }, [p.light]);
  const navRef = useRef<HTMLElement>(null);
  // On a phone the floor card goes under the whole row of floor buttons (it covered the second row).
  const chipsRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(1440);
  const [navH, setNavH] = useState(36);
  useLayoutEffect(() => { const h = navRef.current?.offsetHeight; if (h && h !== navH) setNavH(h); });
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<RoomView | null>(null);
  const kit = useMemo(makeKit, []);
  const [, setFrame] = useState(0);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | undefined>();
  const [hoverFloor, setHoverFloorState] = useState<string | undefined>();
  const floorAt = useRef<[number, number]>([0, 0]);
  const setHoverFloor = (id: string | undefined, el?: Element) => {
    const w = wrap.current?.getBoundingClientRect(), r = el?.getBoundingClientRect();
    if (w && r) floorAt.current = [Math.round(r.right - w.left + 8), Math.round(r.top - w.top)];
    setHoverFloorState(id);
  };
  const [picked, setPicked] = useState<string | undefined>();
  const [prop, setProp] = useState<PropId | undefined>();
  const [focused, setFocused] = useState<string | undefined>();
  const [floorId, setFloorId] = useState<string | undefined>(p.floor);

  const it: Interior = useMemo(
    () => interiorOf({ store, placement, T, placeId, catalog: kit.rooms, caps: p.caps ?? ALL_CAPS, override: p.previewRoom, templateTags: kit.buildingTags, roomTier: kit.roomTier }),
    // the store mutates in place; T and the store version (via T ticks) drive recomputation
    [store, placement, T, placeId, kit, p.caps, p.previewRoom?.room],
  );
  const floor = it.floors.find((f) => f.id === floorId) ?? it.floors.find((f) => f.id === defaultFloor(it)) ?? it.floors[0];

  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    if (!el || !cv) return;
    const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    // The agents' buttons and cards over the room follow where they stand, not every painted frame.
    const notify = frameNotifier(() => viewRef.current?.domKey() ?? '', () => setFrame((f) => f + 1));
    const view = new RoomView({ kit, canvas: cv, reducedMotion: () => !!mq?.matches, onFrame: () => notify.onFrame() });
    viewRef.current = view;
    const fit = () => { const r = el.getBoundingClientRect(); setVw(r.width); view.resize(Math.max(1, r.width), Math.max(1, r.height), globalThis.devicePixelRatio || 1); view.setDark(isNight(lightRef.current, hostDark(el))); };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : undefined;
    ro?.observe(el);
    const offRatio = onRatioChange(fit);
    view.start();
    // The check scripts drive the dev page through this global; production bundles define __DSHU_DEV__ false and drop it.
    if (typeof __DSHU_DEV__ !== 'undefined' && __DSHU_DEV__) (globalThis as { __dshuRoom?: RoomView }).__dshuRoom = view;
    return () => { ro?.disconnect(); offRatio(); view.stop(); notify.dispose(); viewRef.current = null; };
  }, [kit]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v || !floor) return;
    v.setDark(isNight(p.light, hostDark(wrap.current)));
    v.setInput({ interior: it, floor: floor.id, T, rate: tokenRate(store, placeId, T), bayText: Object.fromEntries(it.floors.map((f) => [f.id, floorLabel(f, t) + ' ' + floorValue(f, t, lang)])) });
  }, [it, floor?.id, T]);

  useEffect(() => { viewRef.current?.setFollow(picked); }, [picked]);

  // Escape goes back to the city; PageUp / PageDown change floor.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { if (prop) setProp(undefined); else if (picked) setPicked(undefined); else close(); e.preventDefault(); return; }
    if (!floor) return;
    const i = it.floors.indexOf(floor);
    if (e.key === 'PageUp' && i < it.floors.length - 1) setFloorId(it.floors[i + 1].id);
    else if (e.key === 'PageDown' && i > 0) setFloorId(it.floors[i - 1].id);
    else return;
    e.preventDefault();
  };

  const view = viewRef.current;
  const geo = view?.geometry;
  const local = (e: { clientX: number; clientY: number }) => { const r = wrap.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  // Dragging moves a room that is bigger than the view (phones); a drag is not a click.
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const v = viewRef.current;
    const d = drag.current;
    if (v && d && e.buttons) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.moved || Math.hypot(dx, dy) > 4) { d.moved = true; d.x = e.clientX; d.y = e.clientY; v.panBy(dx, dy); }
      return;
    }
    if (!v || e.pointerType === 'touch') return;
    const [x, y] = local(e);
    const id = v.hitAt(x, y);
    v.setHover(id);
    setHover(id ? { id, x, y } : undefined);
  };
  const onUp = (e: React.PointerEvent) => {
    const v = viewRef.current;
    const dragged = drag.current?.moved;
    drag.current = undefined;
    if (!v || dragged) return;
    const [x, y] = local(e);
    const id = v.hitAt(x, y);
    setPicked(id && id !== picked ? id : undefined);
  };

  const placeTitle = (() => {
    if (it.place !== 'building') return placeName(placeId, t, store);
    const s = it.sessionId ? store.agent(store.agents().find((a) => a.agent.sessionId === it.sessionId && !a.agent.parentAgentId)?.agent.id ?? '') : undefined;
    if (s) return rowOf(s, store, T, t, lang, titles, false).title;
    return (it.sessionId && titles[it.sessionId]) || (it.past ? t('card.past') : t('in.unknown'));
  })();
  const sessionId = it.place === 'building' ? it.sessionId : undefined;

  // The agent card (hovered or picked): title, state, where, tool. Metadata only.
  const agentCard = (() => {
    const id = picked ?? hover?.id;
    if (!id || !view || !floor) return undefined;
    const s = store.agent(id);
    const person = floor.people.find((x) => x.id === id);
    if (!s || !person) return undefined;
    const r = rowOf(s, store, T, t, lang, titles, false);
    const h = view.hits.find((x) => x.id === id);
    const ax = h ? h.r[2] + 10 : (hover?.x ?? 0) + 14, ay = h ? h.r[1] : (hover?.y ?? 0);
    return { id, r, tool: person.tool, sticky: !!picked, x: Math.round(Math.min(view.vp.w - AGENT_CARD_OUTER - 8, Math.max(8, ax))), y: Math.round(Math.min(view.vp.h - 170, Math.max(56, ay))) };
  })();

  const floorCard = (() => {
    const f = it.floors.find((x) => x.id === hoverFloor);
    if (!f) return undefined;
    const lines = [t('in.people', { n: f.people.length })];
    if (f.na) lines.push(t('na'));
    else {
      if (f.template || f.recent.length) lines.push(t('in.recent', { n: f.recent.length }));
      if (f.jobs) lines.push(t('in.jobs', { n: f.jobs }));
      if (f.errors) lines.push(t('in.errors', { n: f.errors }));
      if (f.subs?.length) lines.push(t('in.subs', { n: f.subs.length }));
      if (f.out) lines.push(t('in.out', { n: f.out }));
    }
    if (f.illustrative && !f.na) lines.push(t('in.stub'));
    if (!f.act) lines.push(t('in.still'));
    // The floors of a building are as big as the building: say so where a room is drawn smaller.
    if (it.place === 'building' && it.tier !== 'large') lines.push(t('in.size.' + it.tier));
    return { f, lines };
  })();

  const wide = geo?.wide ?? true;
  const phone = vw < 480;
  // A floor's tooltip follows a mouse pointer or keyboard focus only: a tap focuses the button too, and the tooltip
  // then stayed open over the room after the floor was chosen (#18, covering "On this floor now" at 320 px).
  const floorBtn = (f: InteriorFloor, i: number, style: CSSProperties) => {
    const on = f.id === floor?.id;
    return (
      <button key={f.id} type="button" aria-pressed={on} aria-label={t('in.floorAria', { i: i + 1, n: floorLabel(f, t) + ' ' + floorValue(f, t, lang) })}
        onClick={() => { setFloorId(f.id); setProp(undefined); setHoverFloor(undefined); }} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHoverFloor(f.id, e.currentTarget); }} onPointerLeave={() => setHoverFloor(undefined)}
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setHoverFloor(f.id, e.currentTarget); }} onBlur={() => setHoverFloor(undefined)}
        style={{ ...btn, ...px, ...(on ? pressed : {}), boxShadow: 'none', display: 'flex', alignItems: 'center', gap: 6, minHeight: 24, padding: '0 8px', fontSize: 12, whiteSpace: 'nowrap', ...style }}>
        <i aria-hidden style={{ width: 8, height: 8, background: f.colour, outline: '1px solid #141A30', flex: 'none' }} />
        <b style={{ fontWeight: 600 }}>{floorLabel(f, t)}</b>
        <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>{floorValue(f, t, lang)}</span>
        {f.illustrative && !f.na && <span style={{ opacity: 0.6, fontWeight: 400 }}>{t('in.stub')}</span>}
        {f.people.length > 0 && <span style={{ color: on ? undefined : stateColor('running'), fontWeight: 700 }}>· {f.people.length}</span>}
      </button>
    );
  };

  return (
    <div ref={wrap} tabIndex={-1} onKeyDown={onKey} style={{ position: 'absolute', inset: 0, overflow: 'hidden', color: C.text, userSelect: 'none', outline: 'none' }}>
      <div role="img" aria-label={t('in.aria', { n: placeTitle })} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { viewRef.current?.setHover(undefined); setHover(undefined); }}
        style={{ position: 'absolute', inset: 0, cursor: hover ? 'pointer' : 'default', touchAction: 'none' }}>
        <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }} />
      </div>
      {/* Breadcrumb and back. On a phone (under 480 px): the arrow and the room only, with Open session as its own button. */}
      <nav ref={navRef} aria-label={t('in.floors')} style={{ ...px, position: 'absolute', left: 12, top: 12, display: 'flex', alignItems: 'center', gap: 2, padding: 3, fontSize: 12.5, maxWidth: phone ? 'calc(100% - 24px - 96px)' : 'calc(100% - 24px)', whiteSpace: 'nowrap', zIndex: 3 }}>
        <button type="button" autoFocus style={btn} onClick={close} aria-label={t('in.back')} title={t('in.back')}>←</button>
        {!phone && <><button type="button" style={btn} onClick={close}>{t('in.city')}</button>
        <span aria-hidden style={{ color: C.muted }}>›</span>
        <b style={{ padding: '0 6px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} aria-current="page">{placeTitle}</b></>}
        {floor && <>{!phone && <span aria-hidden style={{ color: C.muted }}>›</span>}<span style={{ padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} {...(phone ? { 'aria-current': 'page' as const, title: placeTitle } : {})}>{floorLabel(floor, t)}</span></>}
        {!phone && sessionId && p.onOpen && <button type="button" style={{ ...btn, marginLeft: 4, whiteSpace: 'nowrap' }} onClick={() => p.onOpen!(sessionId)}>{t('act.open')}</button>}
      </nav>
      {phone && sessionId && p.onOpen && <button type="button" style={{ ...btn, ...px, position: 'absolute', right: 12, top: 12, minHeight: 34, whiteSpace: 'nowrap', zIndex: 3 }} onClick={() => p.onOpen!(sessionId)}>{t('act.open')}</button>}
      {/* Floor buttons: beside the stack (wide), or a row under the breadcrumb (narrow). Top floor first in reading order.
          Above the room's invisible person and prop buttons (z 2), which covered a floor at 320 px. */}
      {wide && geo && geo.labels.length === it.floors.length
        ? it.floors.map((f, i) => floorBtn(f, i, { position: 'absolute', left: Math.round(geo.labels[i][0]), top: Math.round(geo.labels[i][1] - 12), zIndex: 3 }))
        : (
          <div ref={chipsRef} role="group" aria-label={t('in.floors')} style={{ position: 'absolute', left: 12, right: 12, top: 12 + navH + 8, display: 'flex', flexWrap: 'wrap', gap: 4, zIndex: 3 }}>
            {it.floors.map((f, i) => ({ f, i })).reverse().map(({ f, i }) => floorBtn(f, i, {}))}
          </div>
        )}
      {floorCard && (
        <div role="tooltip" style={{ ...px, position: 'absolute', left: wide ? floorAt.current[0] : 12, top: wide ? floorAt.current[1] : (chipsRef.current ? chipsRef.current.offsetTop + chipsRef.current.offsetHeight + 6 : Math.max(96, floorAt.current[1] + 34)), width: 240, padding: '8px 10px', fontSize: 12, lineHeight: '17px', pointerEvents: 'none', zIndex: 4 }}>
          <b style={{ display: 'block' }}>{floorLabel(floorCard.f, t)}</b>
          {floorCard.lines.map((l) => <div key={l} style={{ color: C.muted }}>{l}</div>)}
        </div>
      )}
      {/* The room in one sentence for screen readers (updates as agents come and go). */}
      {floor && <p aria-live="polite" style={SR_ONLY}>{roomSummary(floor, t)}</p>}
      {/* A Tab path through the room: the agents (left to right), then the data props. Invisible until focused. */}
      {geo && view && floor && [...view.hits].sort((a, b) => a.r[0] - b.r[0]).map((h) => {
        const a = floor.people.find((x) => x.id === h.id);
        const s = a && store.agent(a.id), r = s ? rowOf(s, store, T, t, lang, titles, false) : undefined;
        if (!r) return null;
        return <button key={'a' + h.id} type="button" aria-label={r.title + ' · ' + r.stateText + (a?.tool ? ' · ' + a.tool.replace(/^mcp__[^_]+__/, '') : '')} aria-pressed={picked === h.id}
          onFocus={() => { setFocused('a' + h.id); viewRef.current?.setHover(h.id); }} onBlur={() => { setFocused(undefined); viewRef.current?.setHover(undefined); }}
          onMouseEnter={() => { viewRef.current?.setHover(h.id); setHover({ id: h.id, x: h.r[2], y: h.r[1] }); }} onMouseLeave={() => { viewRef.current?.setHover(undefined); setHover(undefined); }}
          onClick={() => setPicked(picked === h.id ? undefined : h.id)}
          style={{ ...overlay, cursor: 'pointer', left: Math.round(h.r[0]), top: Math.round(h.r[1]), width: Math.round(h.r[2] - h.r[0]), height: Math.round(h.r[3] - h.r[1]), outline: focused === 'a' + h.id ? '2px solid #2F6BDE' : 'none' }} />;
      })}
      {geo && geo.props.map((pr) => (
        <button key={'p' + pr.id} type="button" aria-label={t('in.propHint', { name: t('in.prop.' + pr.id) })} aria-expanded={prop === pr.id} title={t('in.prop.' + pr.id)}
          onFocus={() => setFocused('p' + pr.id)} onBlur={() => setFocused(undefined)} onClick={() => setProp(prop === pr.id ? undefined : pr.id as PropId)}
          style={{ ...overlay, cursor: 'pointer', left: Math.round(pr.r[0]), top: Math.round(pr.r[1]), width: Math.max(12, Math.round(pr.r[2] - pr.r[0])), height: Math.max(12, Math.round(pr.r[3] - pr.r[1])), outline: focused === 'p' + pr.id || prop === pr.id ? '2px solid #2F6BDE' : 'none' }} />
      ))}
      {prop && floor && geo && (() => {
        const pr = geo.props.find((x) => x.id === prop);
        if (!pr) return null;
        // Below the prop (wall props are high up, so the card never covers the props beside it), else above it.
        const vh = view?.vp.h ?? 600, below = pr.r[3] + 8 + 200 < vh;
        const x = Math.round(Math.max(8, Math.min((view?.vp.w ?? 800) - PROP_CARD_OUTER - 8, (pr.r[0] + pr.r[2]) / 2 - 124))), y = Math.round(below ? pr.r[3] + 8 : Math.max(56, pr.r[1] - 208));
        return (
          <div role="dialog" aria-label={t('in.prop.' + prop)} style={{ ...px, position: 'absolute', left: x, top: y, width: 248, padding: '10px 12px', fontSize: 12, lineHeight: '18px', zIndex: 6 }}>
            <b style={{ display: 'block', fontSize: 13 }}>{t('in.prop.' + prop)}</b>
            {propLines(prop, floor, t, lang, { rate: tokenRate(store, placeId, T) }).map((l, i) => <div key={i} style={{ color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{l}</div>)}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} aria-label={t('card.close')} onClick={() => setProp(undefined)}>×</button>
            </div>
          </div>
        );
      })()}
      {/* Who is on this floor: a button per agent (keyboard and screen readers reach every person here). */}
      {floor && (
        <section aria-label={t('in.here')} style={{ ...px, position: 'absolute', right: 12, bottom: 12, maxWidth: 280, maxHeight: '40%', overflowY: 'auto', padding: '6px 8px', fontSize: 12, zIndex: 3 }}>
          <b style={{ display: 'block', marginBottom: 2 }}>{t('in.here')}</b>
          {floor.people.length === 0 && <div style={{ color: C.muted }}>{floor.act ? t('in.nobody') : t('in.still')}</div>}
          {floor.people.map((a) => {
            const s = store.agent(a.id);
            const r = s ? rowOf(s, store, T, t, lang, titles, false) : undefined;
            return (
              <button key={a.id} type="button" aria-pressed={picked === a.id} onClick={() => setPicked(picked === a.id ? undefined : a.id)}
                onMouseEnter={() => viewRef.current?.setHover(a.id)} onMouseLeave={() => viewRef.current?.setHover(undefined)}
                style={{ ...btn, ...(picked === a.id ? pressed : {}), display: 'flex', width: '100%', gap: 6, alignItems: 'center', minHeight: 24, padding: '0 4px', textAlign: 'left' }}>
                <i aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: stateColor(s ? stateAt(s, T) : 'idle'), flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{r?.title ?? a.id}</span>
                {a.tool && <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', opacity: 0.8 }}>{a.tool.replace(/^mcp__[^_]+__/, '')}</span>}
              </button>
            );
          })}
        </section>
      )}
      {agentCard && (
        <div role={agentCard.sticky ? 'dialog' : 'tooltip'} aria-label={agentCard.r.title} style={{ ...px, position: 'absolute', left: agentCard.x, top: agentCard.y, width: 236, padding: '10px 12px', fontSize: 12, lineHeight: '18px', pointerEvents: agentCard.sticky ? 'auto' : 'none', zIndex: 5 }}>
          <b style={{ display: 'block', fontSize: 13 }}>{agentCard.r.title}</b>
          <span style={{ color: stateColor(agentCard.r.state), fontWeight: 600 }}>{agentCard.r.stateText}</span>
          {agentCard.tool && <div style={{ color: C.muted }}>{t('in.doing', { tool: agentCard.tool.replace(/^mcp__[^_]+__/, '') })}</div>}
          {floor && <div style={{ color: C.muted }}>{t('in.where', { f: floorLabel(floor, t) })}</div>}
          {agentCard.r.context && <div style={{ color: C.muted }}>{agentCard.r.context}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}><span>{agentCard.r.tokens}</span><span>{agentCard.r.duration}</span></div>
          {agentCard.sticky && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {p.onOpen && <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} onClick={() => p.onOpen!(agentCard.r.sessionId)}>{agentCard.r.waiting ? t('act.confirm') : t('act.open')}</button>}
              <button type="button" style={{ ...btn, ...px, boxShadow: 'none' }} aria-label={t('card.close')} onClick={() => setPicked(undefined)}>×</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
