// Plain styles over the official theme tokens (`--dsw-alias-*`), with fallbacks so the panel also reads in dev mode.
import type { CSSProperties } from 'react';

const v = (name: string, fallback: string) => `var(--dsw-alias-${name}, ${fallback})`;
const tone = (hue: string) => `color-mix(in srgb, ${hue} 70%, currentColor)`;
export const C = {
  // DSH's own label and background tokens (dsh-client theme: label-primary, label-secondary, bg-base); the fallbacks
  // meet WCAG AA in either colour scheme (GrayText does not: 3.9:1 on white).
  text: v('label-primary', 'CanvasText'),
  muted: v('label-secondary', 'color-mix(in srgb, CanvasText 68%, Canvas)'),
  line: 'rgba(127,127,127,.25)',
  card: v('bg-base', 'Canvas'),
  /** Amber text on the amber-tint button (#FFF4DC): 5.5:1. */
  amber: '#8F5600',
  amberBg: 'rgba(240,160,32,.16)',
  // State colours as text: the hue mixed 70/30 with the text colour around it, so they darken on a light theme and
  // lighten on a dark one and reach 4.5:1 on both (the pure hues miss on one side or the other).
  run: tone('#2F6BDE'), wait: tone('#B76E00'), done: tone('#2E8B57'), failed: tone('#C8352B'), idle: tone('#6F7A8C'),
};
export const stateColor = (s: string) => (C as Record<string, string>)[s === 'waiting' ? 'wait' : s === 'running' ? 'run' : s] ?? C.idle;

export const S: Record<string, CSSProperties> = {
  page: { height: '100%', overflow: 'auto', color: C.text, font: '14px/1.5 system-ui, sans-serif', padding: '16px clamp(12px, 3vw, 32px) 48px', boxSizing: 'border-box' },
  head: { fontSize: 18, fontWeight: 600, margin: '4px 0 12px' },
  bar: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 20px', padding: 0, listStyle: 'none' },
  btn: { font: 'inherit', fontSize: 13, padding: '6px 12px', minHeight: 36, borderRadius: 6, border: `1px solid ${C.line}`, background: C.card, color: C.text, cursor: 'pointer' },
  h2: { fontSize: 13, fontWeight: 600, color: C.muted, margin: '20px 0 6px', display: 'flex', gap: 8 },
  card: { border: '2px solid #27304F', borderRadius: 4, overflow: 'hidden', boxShadow: '0 3px 0 rgba(20,26,48,.18)' },
  row: { display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr) auto auto', gap: '0 12px', alignItems: 'center', minHeight: 56, boxSizing: 'border-box', padding: '6px 12px', borderTop: `1px solid ${C.line}` },
  title: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  small: { fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  nums: { fontSize: 12, color: C.muted, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  acts: { display: 'flex', gap: 6, justifyContent: 'flex-end' },
  rowBtn: { font: 'inherit', fontSize: 12, fontWeight: 600, height: 28, padding: '0 10px', borderRadius: 4, border: '2px solid #27304F', background: 'transparent', color: C.text, cursor: 'pointer', whiteSpace: 'nowrap' },
  empty: { padding: '10px 12px', color: C.muted },
  note: { fontSize: 12, color: C.muted, margin: '0 0 12px' },
};
