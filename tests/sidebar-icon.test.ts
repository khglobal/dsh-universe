// The DSH Universe sidebar icon used to be a filled bar chart on a 24 canvas fixed at 16 px, heavier and lower
// than the official Workbench / Plugins / Automation tasks icons. The official contract (see src/client/sidebar-icon.ts):
// <svg> of the given size, 16×16 canvas, no fill, stroke currentColor, 1px stroke, no style, shapes inside the margin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIDEBAR_ICON_PATHS, SidebarIcon } from '../src/client/sidebar-icon.ts';

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

test('drawn at the size the official sidebar passes (16 wide, 18 rail), 16 when none is given', () => {
  for (const size of [16, 18]) {
    const svg = SidebarIcon({ size, active: false }) as unknown as El;
    assert.equal(svg.type, 'svg');
    assert.equal(svg.props.width, size);
    assert.equal(svg.props.height, size);
  }
  const plain = SidebarIcon({}) as unknown as El;
  assert.equal(plain.props.width, 16);
});

test('official Regular drawing: 16×16 canvas, outline in currentColor, 1px stroke, no extra style or margin', () => {
  const { props } = SidebarIcon({ size: 16 }) as unknown as El;
  assert.equal(props.viewBox, '0 0 16 16');
  assert.equal(props.fill, 'none');
  assert.equal(props.stroke, 'currentColor');
  assert.equal(props.strokeWidth, 1);
  for (const key of ['style', 'className']) assert.equal(props[key], undefined, key);
  const children = [props.children].flat(Infinity) as El[];
  assert.equal(children.length, SIDEBAR_ICON_PATHS.length);
  for (const child of children) {
    assert.equal(child.type, 'path');
    assert.deepEqual(Object.keys(child.props).sort(), ['d']);
  }
});

test('shapes keep the official margin: absolute commands only, every coordinate inside 1.5–14.5', () => {
  for (const d of SIDEBAR_ICON_PATHS) {
    assert.doesNotMatch(d, /[a-z]/u, `${d}: absolute commands only`);
    for (const value of (d.match(/-?\d*\.?\d+/gu) ?? []).map(Number)) assert.ok(value >= 1.5 && value <= 14.5, `${d}: ${value}`);
  }
});

test('the sidebar entry registers this icon component directly (no wrapper)', () => {
  const source = readFileSync(new URL('../src/client/register.ts', import.meta.url), 'utf8');
  assert.match(source, /name: 'sidebar\.panellist'[^\n]*\}, SidebarIcon as never\)\)/u);
});
