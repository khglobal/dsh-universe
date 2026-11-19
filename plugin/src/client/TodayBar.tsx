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
  return (
    <ul style={oneRow ? { ...S.bar, margin: 0, padding: '2px 2px 6px' } : S.bar} aria-label={t('td.label')} data-dshu-today="">
      {buttons.map((b) => {
        const sched = b.cat === 'sched';
        const base = oneRow || chrome ? todayBtn(b.amber, active === b.cat) : b.amber ? { ...S.btn, background: 'rgba(240,160,32,.16)', borderColor: C.wait, color: C.wait, fontWeight: 600 } : S.btn;
        return (
          <li key={b.cat} style={{ flex: 'none', minWidth: 0, maxWidth: '100%' }}>
            <button type="button" style={{ ...base, maxWidth: sched ? `min(${SCHED_MAX}px, 100%)` : '100%', ...(sched ? { overflow: 'hidden', textOverflow: 'ellipsis' } : {}) }}
              aria-pressed={oneRow ? active === b.cat : undefined} aria-disabled={b.count === 0} title={b.title ?? (sched ? b.text : undefined)}
              aria-label={sched ? b.text : undefined} data-dshu-sched={sched || undefined}
              data-dshu-local={b.local || undefined} onClick={() => b.count > 0 && onPress(b.cat)}>
              {b.text}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
