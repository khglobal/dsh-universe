// A `UniverseAdapter` over a local session store: detection is only "does the folder exist"; a snapshot runs passes
// until the store is caught up (or a time budget is spent); a subscription watches the folder and runs a pass after
// each change, and every few seconds anyway.
import { existsSync } from 'node:fs';
import type { UCapabilities, UEvent, UPlatform, USnapshot } from '@dsh-universe/model';
import type { ConsentRequest, UniverseAdapter } from '../adapter.ts';
import { createLocalCity, type LocalCity, type StoreReader } from './city.ts';
import { watchTree } from './files.ts';

export interface LocalAdapterOptions<S> {
  platform: Omit<UPlatform, 'caps'>;
  caps: UCapabilities;
  /** The folder whose presence means the tool is on this device. */
  root: string;
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
}

export interface LocalAdapter extends UniverseAdapter {
  /** Today's events so far (the adapter keeps them; a new day starts the list again). */
  events(): readonly UEvent[];
  history(): USnapshot['history'];
  /** Whether the first full read of the store is done. */
  caughtUp(): boolean;
  /** Bumps when the list starts again (a new day). */
  epoch(): number;
}

export function createLocalAdapter<S>(o: LocalAdapterOptions<S>): LocalAdapter {
  let city: LocalCity = createLocalCity(o.reader, { now: o.now, passMs: o.passMs, onTitle: o.onTitle });
  let log: UEvent[] = [];
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
    async detect() { return { present: existsSync(o.root) }; },
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
    events: () => log,
    history: () => city.history(),
    caughtUp: () => caught,
    epoch: () => epoch,
  };
}
