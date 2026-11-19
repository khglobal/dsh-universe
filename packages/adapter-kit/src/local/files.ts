// Node-only helpers for adapters that read another tool's local session store (JSON Lines files under the member's
// home folder). Reading is incremental: a file is read from where the last pass stopped (a byte offset), only whole
// lines, and only a bounded number of bytes per pass. Nothing here keeps or returns more than the lines asked for;
// what a line may contribute is decided by the adapter, and everything it emits goes through `sanitize`.
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface FileRef { path: string; size: number; mtimeMs: number }

/** Lines longer than this are skipped unread (an inline image or a huge tool result; never metadata). */
export const MAX_LINE_BYTES = 4 * 1024 * 1024;

/** A short stable id of a path (the path itself never leaves the host). */
export const pathId = (path: string): string => createHash('sha256').update(path).digest('hex').slice(0, 16);
/** The folder name only, as the DSH adapter shows a workspace. */
export const folderName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';

/**
 * Files under `dir` (at most `depth` levels down) whose path relative to `dir` matches, with size and time. Symbolic
 * links are not followed. Missing or unreadable folders give nothing. `yieldEvery` keeps a large tree from holding
 * the event loop.
 */
export async function listFiles(dir: string, match: (rel: string) => boolean, o: { depth: number; since?: number; tick?: () => Promise<void> }): Promise<FileRef[]> {
  const out: FileRef[] = [];
  const walk = async (d: string, rel: string, depth: number): Promise<void> => {
    let ents;
    try { ents = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      await o.tick?.();
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (depth > 0) await walk(join(d, e.name), r, depth - 1); continue; }
      if (!e.isFile() || !match(r)) continue;
      try {
        const st = await stat(join(d, e.name));
        if (o.since === undefined || st.mtimeMs >= o.since) out.push({ path: join(d, e.name), size: st.size, mtimeMs: st.mtimeMs });
      } catch { /* gone meanwhile */ }
    }
  };
  await walk(dir, '', o.depth);
  return out;
}

/** Whole lines of `path` in bytes [from, to): a line cut by either end is left out. */
export async function readLines(path: string, from: number, to: number): Promise<{ lines: string[]; starts: number[]; end: number }> {
  if (to <= from) return { lines: [], starts: [], end: from };
  let fh;
  try { fh = await open(path, 'r'); } catch { return { lines: [], starts: [], end: from }; }
  try {
    const buf = Buffer.allocUnsafe(to - from);
    const { bytesRead } = await fh.read(buf, 0, to - from, from);
    const b = buf.subarray(0, bytesRead);
    const last = b.lastIndexOf(10);
    if (last < 0) return { lines: [], starts: [], end: from };
    const lines: string[] = [], starts: number[] = [];
    let s = 0;
    for (let i = b.indexOf(10); i >= 0 && i <= last; i = b.indexOf(10, i + 1)) {
      if (i - s <= MAX_LINE_BYTES) { lines.push(b.toString('utf8', s, i)); starts.push(from + s); }
      s = i + 1;
    }
    return { lines, starts, end: from + last + 1 };
  } finally { await fh.close().catch(() => undefined); }
}

/**
 * The next whole lines after `offset`, reading at most `maxBytes`. A line longer than `maxBytes` is skipped: the
 * offset moves past its end without keeping it. Returns the new offset.
 */
export async function readNext(path: string, offset: number, size: number, maxBytes: number): Promise<{ lines: string[]; offset: number }> {
  const to = Math.min(size, offset + maxBytes);
  const r = await readLines(path, offset, to);
  if (r.end > offset || to >= size) return { lines: r.lines, offset: r.end };
  // No newline in a whole window: one very long line. Find its end and step over it.
  let fh;
  try { fh = await open(path, 'r'); } catch { return { lines: [], offset }; }
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let at = to; at < size;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, at);
      if (!bytesRead) break;
      const i = buf.subarray(0, bytesRead).indexOf(10);
      if (i >= 0) return { lines: [], offset: at + i + 1 };
      at += bytesRead;
    }
    return { lines: [], offset };
  } finally { await fh.close().catch(() => undefined); }
}

/**
 * The first line at or after `t` in a file whose lines carry increasing times: a binary search on byte offsets
 * (each probe reads one small window and the time of the first whole line in it). Returns a line start; 0 when the
 * file is small or the times cannot be read.
 */
export async function seekTime(path: string, size: number, t: number, timeOf: (line: string) => number | undefined, small = 4 << 20): Promise<number> {
  if (size <= small) return 0;
  const probe = async (at: number): Promise<{ start: number; time?: number } | undefined> => {
    const r = await readLines(path, at, Math.min(size, at + (256 << 10)));
    // The first line may be cut by the window's start: it counts only when the window starts the file.
    for (let i = at === 0 ? 0 : 1; i < r.lines.length; i++) {
      const tm = timeOf(r.lines[i]);
      if (tm !== undefined) return { start: r.starts[i], time: tm };
    }
    return undefined;
  };
  let lo = 0, hi = size, best = 0;
  for (let k = 0; k < 40 && hi - lo > (256 << 10); k++) {
    const mid = Math.floor((lo + hi) / 2);
    const p = await probe(mid);
    if (!p || p.time === undefined) { hi = mid; continue; }
    if (p.time < t) { lo = mid; best = p.start; } else hi = mid;
  }
  return best;
}

/** A time budget for one pass: `tick()` gives the event loop a turn every `sliceMs`; `over()` once `totalMs` is spent. */
export function budget(totalMs: number, sliceMs = 6, now: () => number = () => performance.now()) {
  const t0 = now();
  let last = t0;
  return {
    over: () => now() - t0 > totalMs,
    async tick() { if (now() - last > sliceMs) { await new Promise<void>((r) => setImmediate(r)); last = now(); } },
  };
}

/** `"timestamp":"<ISO time>"` of a JSON line without parsing it (the field name and value only). */
export function isoTimeOf(line: string): number | undefined {
  const m = /"timestamp":"(\d{4}-\d\d-\d\dT[^"]{6,40})"/.exec(line);
  if (!m) return undefined;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Calls `fn` (at most once a second) when anything under `dir` changes. Recursive where the platform supports it;
 * returns the stop. A folder that cannot be watched gives a no-op stop (the caller's regular passes still run).
 */
export function watchTree(dir: string, fn: () => void, waitMs = 1000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let w: ReturnType<typeof watch> | undefined;
  try {
    w = watch(dir, { recursive: true, persistent: false }, () => { timer ??= setTimeout(() => { timer = undefined; fn(); }, waitMs); });
    w.on('error', () => { try { w?.close(); } catch { /* closed */ } });
  } catch { return () => {}; }
  return () => { if (timer) clearTimeout(timer); try { w?.close(); } catch { /* closed */ } };
}
