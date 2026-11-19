import { useState } from 'react';
import type { TodayButton } from './view.ts';
import { C, S } from './styles.ts';
import { todayBtn } from './chrome.ts';
import type { Translate } from './types.ts';

/** The next scheduled task's button at most this wide over the city (its title ends in an ellipsis; the name keeps it whole). */
const SCHED_MAX = 260;

/**
 * The six things, most urgent first. Each press goes to the next item of its kind; the first is always amber. In
 * the city they wear the game chrome and the button whose layer is on shows pressed. Over the city they wrap onto a
 * second (or third, on a phone) line rather than hide behind a scroller: every figure stays on screen at any width
 * (scripts/todaybar-check.mjs, 1920 to 390 px); only the scheduled task's title is shortened.
 */
export function TodayBar({ buttons, t, onPress, oneRow, active, chrome }: {
  buttons: TodayButton[]; t: Translate; onPress(cat: TodayButton['cat']): void;
  /** Over the city: the hard-edged chrome, tight rows that wrap. */ oneRow?: boolean;
  /** The button whose layer is shown now. */ active?: TodayButton['cat'];
  /** The game chrome without the city's layout (the list view). */ chrome?: boolean;
}) {
  // The "+n local" breakdown by city: a `title` alone is mouse-only, so it also shows under the bar while its figure
  // has keyboard focus or after a touch press, and each figure's button is described by it. Esc or blur hides it. No
  // extra control: the bar keeps its width (#25).
  const [shown, setShown] = useState<TodayButton['cat'] | null>(null);
  const tip = buttons.find((b) => b.cat === shown && b.local && b.title);
  return (
    <ul style={{ ...(oneRow ? { ...S.bar, margin: 0, padding: '2px 2px 6px' } : S.bar), position: 'relative' }} aria-label={t('td.label')} data-dshu-today=""
      onKeyDown={(e) => { if (e.key === 'Escape' && shown) { e.stopPropagation(); setShown(null); } }}>
      {buttons.map((b) => {
        const sched = b.cat === 'sched';
        const base = oneRow || chrome ? todayBtn(b.amber, active === b.cat) : b.amber ? { ...S.btn, background: 'rgba(240,160,32,.16)', borderColor: C.wait, color: C.wait, fontWeight: 600 } : S.btn;
        const by = b.local && b.title ? `dshu-by-${b.cat}` : undefined;
        // The scheduled task's item is capped, not only its button: an item as wide as the whole title left a gap
        // after the shortened button and wrapped the bar early (#25).
        return (
          <li key={b.cat} style={{ flex: 'none', minWidth: 0, maxWidth: sched ? `min(${SCHED_MAX}px, 100%)` : '100%' }}>
            <button type="button" style={{ ...base, maxWidth: '100%', ...(sched ? { overflow: 'hidden', textOverflow: 'ellipsis' } : {}) }}
              aria-pressed={oneRow ? active === b.cat : undefined} aria-disabled={b.count === 0} title={b.title ?? (sched ? b.text : undefined)}
              aria-label={sched ? b.text : undefined} aria-describedby={by} data-dshu-sched={sched || undefined}
              data-dshu-local={b.local || undefined} onClick={() => b.count > 0 && onPress(b.cat)}
              onFocus={by ? (e) => { if (e.currentTarget.matches(':focus-visible')) setShown(b.cat); } : undefined}
              onPointerUp={by ? (e) => { if (e.pointerType === 'touch') setShown(b.cat); } : undefined}
              onBlur={by ? () => setShown((c) => (c === b.cat ? null : c)) : undefined}>
              {b.text}
            </button>
            {by && <span id={by} hidden>{b.title}</span>}
          </li>
        );
      })}
      {tip && (
        <li role="presentation" aria-hidden="true" data-dshu-by-text=""
          style={{ position: 'absolute', top: '100%', left: 0, zIndex: 6, width: 'max-content', maxWidth: 'min(420px, 100%)', boxSizing: 'border-box',
            padding: '6px 8px', fontSize: 12, lineHeight: 1.45, background: C.card, color: C.text, border: `2px solid ${C.text}`, borderRadius: 4, pointerEvents: 'none' }}>
          {tip.title}
        </li>
      )}
    </ul>
  );
}
