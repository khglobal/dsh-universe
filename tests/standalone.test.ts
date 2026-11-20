import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as host from '../src/index.ts';
import { loadClient } from './bundle.ts';

const client = await loadClient<typeof import('../src/client.ts')>();

type Reg = { owner: string; options: Record<string, unknown>; disposed: boolean };

export function fakeClientCtx(services: Record<string, unknown> = {}) {
  const regs: Reg[] = [];
  const effects: (() => void)[] = [];
  const ctx = {
    slots: {
      inject(owner: string, fn: () => (() => void) | void) { const d = fn(); if (d) effects.push(d); void owner; },
      register(options: Record<string, unknown>) { const r: Reg = { owner: String(options.name), options, disposed: false }; regs.push(r); return () => { r.disposed = true; }; },
    },
    locale: { register: () => () => {}, bind: () => (k: string) => k },
    effect(fn: () => (() => void) | void) { const d = fn(); if (d) effects.push(d); },
    get: (name: string) => services[name],
  };
  return { ctx, regs, dispose: () => { for (const d of effects.splice(0).reverse()) d(); } };
}

test('client: on official DSH (no workbench, no optional services) it registers the panel and its sidebar entry', () => {
  const f = fakeClientCtx();
  client.apply(f.ctx as never);
  assert.ok(f.regs.some((r) => r.owner === 'main' && r.options.key === 'khglobal-dsh-universe'));
  assert.ok(f.regs.some((r) => r.owner === 'sidebar.panellist' && r.options.id === 'khglobal-dsh-universe'));
  assert.ok(f.regs.some((r) => r.owner === 'workbench.tile' && r.options.id === '@khglobal/dsh-universe#today'), 'the tile waits on the workbench slot (inject runs only when it exists)');
  f.dispose();
  assert.ok(f.regs.every((r) => r.disposed), 'everything is unregistered on deactivation');
});

test('host: activates with no optional services (no schedule, mcpManager, workbench), registers its route, cleans up', async () => {
  const effects: unknown[] = [];
  let route: { path: string } | undefined, removed = false;
  const listeners: string[] = [];
  await host.apply({
    effect: (fn: () => unknown) => { effects.push(fn()); },
    get: () => undefined,
    on: (n: string) => { listeners.push(n); return () => {}; },
    connection: { fetch: { register: (r: { path: string }) => { route = r; return () => { removed = true; }; } } },
  } as never);
  assert.equal(host.name, '@khglobal/dsh-universe');
  assert.equal(route?.path, '/api/khglobal-dsh-universe');
  assert.ok(listeners.includes('session/event') && listeners.includes('session/created'));
  for (const d of effects) if (typeof d === 'function') await d();
  assert.ok(removed);
});

test('host: activates with nothing at all (no connection either)', async () => {
  await host.apply({ effect: () => {}, get: () => { throw new Error('not injected'); } } as never);
});

test('dist: the browser file is a module-loader factory exporting name, inject and apply', { skip: !existsSync(new URL('../dist/client.browser.js', import.meta.url)) }, () => {
  const code = readFileSync(new URL('../dist/client.browser.js', import.meta.url), 'utf8');
  let loaded: { id: string; factory: (req: (id: string) => unknown) => Record<string, unknown> } | undefined;
  const req = createRequire(import.meta.url);
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (m: typeof loaded) => { loaded = m; } } } });
  assert.equal(loaded?.id, '@khglobal/dsh-universe');
  const mod = loaded!.factory((id) => req(id));
  assert.equal(mod.name, '@khglobal/dsh-universe');
  assert.equal(typeof mod.apply, 'function');
});

test('package: the fields the DSH development client and installer require', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client.platform, 'web');
  for (const k of ['.', './client', './package.json', './locale/*.json']) assert.ok(pkg.exports[k], k);
  for (const [k, v] of Object.entries<{ default?: string } | string>(pkg.exports)) {
    const target = typeof v === 'string' ? v : v.default!;
    assert.match(target, /^\.\/(dist|locale)\/|^\.\/package\.json$/, k);
  }
  assert.ok(!JSON.stringify(pkg).includes('workspace:'), 'no workspace: ranges in the packed manifest');
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  // The plugin catalog requires that the insert id and the module name both equal the package name.
  assert.match(patch, /^- insert:\n\s+- id: '@khglobal\/dsh-universe'\n\s+name: '@khglobal\/dsh-universe'/m);
  assert.equal(pkg.license, 'SEE LICENSE IN LICENSE');
});
