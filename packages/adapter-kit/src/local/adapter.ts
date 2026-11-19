// A `UniverseAdapter` over a local session store: detection is only "does the folder exist"; a snapshot runs passes
// until the store is caught up (or a time budget is spent); a subscription watches the folder and runs a pass after
// each change, and every few seconds anyway.
import { existsSync } from 'node:fs';
import type { UCapabilities, UEvent, UPlatform, USnapshot } from '@dsh-universe/model';
import type { ConsentRequest, UniverseAdapter } from '../adapter.ts';
import { createLocalCity, type CityCheckpoint, type LocalCity, type StoreReader } from './city.ts';
import { watchTree } from './files.ts';
import { sanitize } from '../allow.ts';

export interface LocalAdapterOptions<S> {
  platform: Omit<UPlatform, 'caps'>;
  caps: UCapabilities;
  /** The folder whose presence means the tool is on this device. */
  root: string;
  /** In place of `root`, when a tool's store may be in one of several folders. */
  present?: () => boolean;
  /** Folders to watch for changes (inside `root`). */
  watch: readonly string[];
  reader: StoreReader<S>;
  consent: ConsentRequest;
  now?: () => number;
  /** Time spent per pass, and between passes while not caught up (the event loop is handed back in between). */
  passMs?: number;
  /** Regular passes, besides the watcher. */
  everyMs?: number;
  onTitle?: (sessionId: string, title: string) => void;
  /** What an earlier run read (see `checkpoint`): the store is not read again where nothing changed. */
  restore?: AdapterCheckpoint;
}

/** A city's reading plus today's events read so far (the events only when the city's day is kept). */
export interface AdapterCheckpoint { city: CityCheckpoint; events: UEvent[] }

export interface LocalAdapter extends UniverseAdapter {
  /** Today's events so far (the adapter keeps them; a new day starts the list again). */
  events(): readonly UEvent[];
  history(): USnapshot['history'];
  /** Whether the first full read of the store is done. */
  caughtUp(): boolean;
  /** Bumps when the list starts again (a new day). */
  epoch(): number;
  /** What was read so far, between passes (`oldOnly`: only older files, without today's events). */
  checkpoint(oldOnly?: boolean): Promise<AdapterCheckpoint>;
}

export function createLocalAdapter<S>(o: LocalAdapterOptions<S>): LocalAdapter {
  let city: LocalCity = createLocalCity(o.reader, { now: o.now, passMs: o.passMs, onTitle: o.onTitle, ...(o.restore ? { restore: o.restore.city } : {}) });
  // Today's reading taken up from an earlier run comes with the events it gave.
  let log: UEvent[] = city.restored() === 'day' ? o.restore!.events.map(sanitize).filter((e): e is UEvent => !!e) : [];
  let caught = false, epoch = 0, running: Promise<boolean> | undefined;
  const subs = new Set<(e: UEvent) => void>();
  let stopWatch: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** One pass; true when the store is caught up. Passes never overlap. */
  const pass = (): Promise<boolean> => (running ??= (async () => {
    try {
      const r = await city.pass();
      if (r.reset) { log = []; epoch++; caught = false; }
      for (const e of r.events) { log.push(e); for (const f of subs) f(e); }
      if (r.complete) caught = true;
      return r.complete;
    } finally { running = undefined; }
  })());

  const schedule = (ms: number) => {
    if (timer || !subs.size) return;
    timer = setTimeout(async () => {
      timer = undefined;
      const done = await pass().catch(() => true);
      // Not caught up: the next pass soon (the event loop had its turns in between); else the regular rhythm.
      schedule(done ? (o.everyMs ?? 5000) : 50);
    }, ms);
    (timer as { unref?: () => void }).unref?.();
  };

  return {
    platform: o.platform.id,
    async detect() { return { present: o.present ? o.present() : existsSync(o.root) }; },
    describeConsent: () => o.consent,
    capabilities: () => o.caps,
    async snapshot(day) {
      const t0 = Date.now();
      while (!caught && Date.now() - t0 < 10_000) { if (await pass()) break; }
      return { platform: { ...o.platform, caps: o.caps }, day: day || city.day(), seq: log.length, events: log.slice(), history: city.history() };
    },
    subscribe(emit) {
      subs.add(emit);
      if (!stopWatch.length) stopWatch = o.watch.map((d) => watchTree(d, () => { city.touch(); if (timer) { clearTimeout(timer); timer = undefined; } schedule(0); }));
      schedule(0);
      return () => {
        subs.delete(emit);
        if (!subs.size) { for (const s of stopWatch) s(); stopWatch = []; if (timer) { clearTimeout(timer); timer = undefined; } }
      };
    },
    async stop() {
      subs.clear();
      for (const s of stopWatch) s();
      stopWatch = [];
      if (timer) { clearTimeout(timer); timer = undefined; }
      await running?.catch(() => undefined);
      city = createLocalCity(o.reader, { now: o.now, passMs: o.passMs, onTitle: o.onTitle });
      log = []; caught = false; epoch++;
    },
    async checkpoint(oldOnly) {
      // Between passes, so the files' offsets and the events agree.
      while (running) await running.catch(() => undefined);
      return { city: city.save(oldOnly), events: oldOnly ? [] : log.slice() };
    },
    events: () => log,
    history: () => city.history(),
    caughtUp: () => caught,
    epoch: () => epoch,
  };
}
