// The ambient sound's audio graph, on a fake Web Audio context: every city (DSH and the neighbours) has its own bus
// into one master gain; only the city in view is heard, a move crossfades; the cities-around view mixes them quietly;
// each bus follows its own city's activity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '@dsh-universe/model';
import { CITY_PITCH, QUIET, createAmbience, levelsOf, type AudioLike } from '../src/client/sound.ts';

type Node = { kind: string; to: Node[]; gain?: Param; frequency?: Param; type?: string; started?: number; stopped?: number };
type Param = { value: number; targets: [number, number][]; setValueAtTime(v: number, t: number): void; setTargetAtTime(v: number, t: number, c: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
function fakeAudio() {
  const nodes: Node[] = [];
  const param = (): Param => ({ value: 0, targets: [], setValueAtTime(v) { this.value = v; }, setTargetAtTime(v, t) { this.targets.push([v, t]); this.value = v; }, exponentialRampToValueAtTime() {} });
  const node = (kind: string, extra: Partial<Node> = {}): Node & { connect<T>(n: T): T; start(t?: number): void; stop(t?: number): void; disconnect(): void } => {
    const n = { kind, to: [] as Node[], ...extra, connect<T>(x: T) { n.to.push(x as unknown as Node); return x; }, start(t = 0) { n.started = t; }, stop(t = 0) { n.stopped = t; }, disconnect() { n.to = []; } };
    nodes.push(n);
    return n;
  };
  const destination = node('destination');
  const a = { currentTime: 0, state: 'running', destination, createGain: () => node('gain', { gain: param() }), createOscillator: () => node('osc', { frequency: param(), type: 'sine' }), createBiquadFilter: () => node('filter', { frequency: param(), type: 'lowpass' }) };
  return { a: a as unknown as AudioLike & { currentTime: number }, nodes, destination };
}
const reaches = (n: Node, target: Node, seen = new Set<Node>()): boolean => n === target || (!seen.has(n) && (seen.add(n), n.to.some((x) => reaches(x, target, seen))));

test('ambience: a bus per city, all into the master and out; only the city in view is heard', () => {
  const { a, nodes, destination } = fakeAudio();
  const amb = createAmbience(a, () => 0);
  const busy = { running: 3, errors: 2, traffic: 30, waiting: 1 };
  amb.set({ dsh: QUIET, claude: busy, chatgpt: busy, workbuddy: busy }, { claude: 1 });
  assert.deepEqual(amb.buses(), ['claude'], 'a city never heard gets no bus');
  amb.set({ dsh: QUIET, claude: busy, chatgpt: busy, workbuddy: busy }, { dsh: 0.3, claude: 0.3, chatgpt: 0.3, workbuddy: 0.3 });
  assert.deepEqual(amb.buses().sort(), ['chatgpt', 'claude', 'dsh', 'workbuddy']);
  const oscs = nodes.filter((n) => n.kind === 'osc' && n.started !== undefined);
  for (const id of ['claude', 'chatgpt', 'workbuddy']) {
    const mine = oscs.filter((o) => Math.abs((o.frequency!.value) - CITY_PITCH[id] / 2) < 1);
    assert.ok(mine.length >= 1 && mine.every((o) => reaches(o, destination)), `${id}: its murmur reaches the speakers`);
  }
  // Moving into ChatGPT: its bus up, the others down (a crossfade: targets, not jumps).
  const gains = () => nodes.filter((n) => n.kind === 'gain' && n.to.some((x) => x.kind === 'gain' && x.to.includes(destination)));
  amb.set({ chatgpt: busy }, { chatgpt: 1 });
  const levels = gains().map((g) => g.gain!.value).sort();
  assert.deepEqual(levels, [0, 0, 0, 1], 'one city heard at a time');
  assert.ok(gains().every((g) => g.gain!.targets.length >= 1), 'levels change through setTargetAtTime (a fade)');
});

test('ambience: each bus follows its own activity; nothing when quiet; stop fades out', () => {
  const { a, nodes } = fakeAudio();
  const amb = createAmbience(a, () => 0);
  amb.set({ claude: QUIET, workbuddy: { running: 2, errors: 1, traffic: 40, waiting: 2 } }, { claude: 1, workbuddy: 1 });
  const before = nodes.length;
  a.currentTime = 1;
  amb.step();
  const blips = nodes.slice(before).filter((n) => n.kind === 'osc');
  assert.ok(blips.length >= 4, 'traffic tick, error sign and wait notes for the busy city');
  assert.ok(blips.every((o) => o.frequency!.value > CITY_PITCH.workbuddy - 1), 'all on the busy city\'s pitch, none on the quiet one');
  const murmurs = nodes.filter((n) => n.kind === 'gain' && n.to.length === 1 && n.to[0].kind === 'gain' && nodes.some((f) => f.kind === 'filter' && f.to.includes(n)));
  assert.deepEqual(murmurs.map((m) => m.gain!.value > 0).sort(), [false, true], 'a murmur only where sessions run');
  amb.stop();
  const master = nodes.find((n) => n.kind === 'gain' && n.to.some((x) => x.kind === 'destination'))!;
  assert.equal(master.gain!.value, 0);
  const n0 = nodes.length; amb.step(); amb.set({ claude: QUIET }, { claude: 1 });
  assert.equal(nodes.length, n0, 'stopped: nothing more');
});

test('ambience: a city\'s activity is its running sessions, recent failed calls and recent calls', () => {
  const T = Date.now();
  const st = createStore();
  st.applyAll([
    { type: 'agent', data: { id: 'a', sessionId: 'a', workspaceId: 'w', label: '', kind: 'main', state: 'running', startedAt: T - 3600_000 } },
    { type: 'activity', data: { id: '1', t: T - 60_000, agentId: 'a', category: 'exec', tool: 'Bash', ok: false } },
    { type: 'activity', data: { id: '2', t: T - 20 * 60_000, agentId: 'a', category: 'exec', tool: 'Bash', ok: false } },
    { type: 'activity', data: { id: '3', t: T - 2 * 60_000, agentId: 'a', category: 'read', tool: 'Read', ok: true } },
    { type: 'activity', data: { id: '4', t: T - 90 * 60_000, agentId: 'a', category: 'read', tool: 'Read', ok: false } },
  ]);
  assert.deepEqual(levelsOf(st, T, 1, 0), { running: 1, errors: 2, traffic: 2, waiting: 0 });
});
