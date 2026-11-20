// The hard-edged panel chrome of the city: 2 px dark border, hard shadow, square-ish corners.
import type { CSSProperties } from 'react';
import { C } from './styles.ts';

export const px = { border: '2px solid #27304F', boxShadow: '0 3px 0 rgba(20,26,48,.28)', borderRadius: 6, background: C.card } satisfies CSSProperties;
export const btn: CSSProperties = { font: 'inherit', fontSize: 12.5, fontWeight: 600, minHeight: 30, padding: '0 10px', border: 0, borderRadius: 4, background: 'transparent', color: C.text, cursor: 'pointer' };
export const pressed: CSSProperties = { background: C.text, color: C.card };


/** The class on the city panel's root; the rules below give every button in it hover, press and focus states. */
export const CHROME_ROOT = 'dshu-city';
/** Hover darkens a little, press sinks 2 px, keyboard focus gets a clear ring. No transitions. */
export const CHROME_CSS = [
  `.${CHROME_ROOT} button{cursor:pointer}`,
  `.${CHROME_ROOT} button:not([aria-disabled="true"]):hover{background-image:linear-gradient(rgba(127,127,127,.16),rgba(127,127,127,.16))!important}`,
  `.${CHROME_ROOT} button:not([aria-disabled="true"]):active{transform:translateY(2px)}`,
  `.${CHROME_ROOT} button:focus-visible{outline:3px solid #2F6BDE;outline-offset:2px}`,
  `.${CHROME_ROOT} [role="dialog"]:focus-visible{outline:3px solid #2F6BDE;outline-offset:2px}`,
].join('\n');

/** List rows on narrow screens: the actions go under the title, so the title keeps its width. */
export const LIST_CSS = '@media (max-width: 600px){.dshu-srow{grid-template-columns:64px minmax(0,1fr) auto!important;row-gap:6px!important}.dshu-srow .dshu-acts{grid-column:2/4;grid-row:2;justify-content:flex-start!important}}';

/** A today-bar button in the game chrome: amber first, pressed when its layer is on. */
export function todayBtn(amber: boolean, on: boolean): CSSProperties {
  return {
    font: 'inherit', fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', height: 30, padding: '0 10px', whiteSpace: 'nowrap',
    border: '2px solid ' + (on ? C.text : amber ? '#F0A020' : '#27304F'), borderRadius: 4,
    boxShadow: on ? 'none' : '0 3px 0 rgba(20,26,48,.28)', transform: on ? 'translateY(2px)' : undefined,
    // Pressed follows the toolbar's `pressed` (ink on card, inverted in dark) so it shows on both pages.
    background: on ? C.text : amber ? '#FFF4DC' : C.card,
    color: on ? C.card : amber ? C.amber : C.text, cursor: 'pointer',
  };
}
/** A segmented group of buttons in the game chrome (the city / list toggle). */
export const group: CSSProperties = { display: 'flex', gap: 2, padding: 3, border: '2px solid #27304F', borderRadius: 4, boxShadow: '0 3px 0 rgba(20,26,48,.28)', background: C.card };
export const groupBtn = (on: boolean): CSSProperties => ({ font: 'inherit', fontSize: 12.5, fontWeight: 600, height: 26, padding: '0 12px', border: 0, borderRadius: 3, background: on ? C.text : 'transparent', color: on ? C.card : C.text, cursor: 'pointer' });
