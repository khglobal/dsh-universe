// The sidebar entry icon: a small city (a house, a tower with windows, a low block, the street), drawn the way official
// DSH draws its own sidebar icons so the row lines up with Workbench, Plugins and Automation tasks.
//
// Official `sidebar.panellist` (dsh-client-ui-sidebar SidebarRoot.tsx, 0.2.2-rc.2) puts the icon in an inline-flex box
// with no fixed width and passes the edge as `size` (16 in the wide sidebar, 18 in the rail); the label starts right
// after that box. The official icons (dsh-client-ui-primitives IconPluginPinwheelOutlineRegular,
// IconClockOutlineRegular) are an <svg> of `size`×`size`, 16×16 canvas, no fill, stroke currentColor, 1px stroke,
// shapes inside about 1.5–14.5. Anything else (a fixed 16 px box, a 24 canvas, filled shapes, a text glyph, a wrapper)
// changes the size, weight or baseline of the icon and moves the label. The plugin catalog
// checks this on every release.
import { createElement, type ReactElement } from 'react';

/** Absolute commands only, every coordinate inside 1.5–14.5 (the guard checks the margin). */
export const SIDEBAR_ICON_PATHS = [
  'M1.5 14H14.5',               // street
  'M2.5 14V8.5L4.75 6.5L7 8.5V14', // house with a pitched roof
  'M4 14V11.5H5.5V14',          // its door
  'M7 14V3H11V14',              // tower
  'M8.5 5.5H9.5M8.5 8H9.5M8.5 10.5H9.5', // tower windows
  'M11 14V7H13.5V14',           // low block
] as const;

/**
 * Render the city glyph at the size the official sidebar asks for.
 * @param props - the sidebar's icon share: `size` (16 wide, 18 rail) and `active` (unused, as on official icons).
 * @returns the icon element, the row's direct icon child.
 */
export function SidebarIcon({ size = 16 }: { readonly size?: number; readonly active?: boolean }): ReactElement {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }, ...SIDEBAR_ICON_PATHS.map((d) => createElement('path', { key: d, d })));
}
