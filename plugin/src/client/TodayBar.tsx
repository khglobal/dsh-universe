import { useRef } from 'react';
import { useEdgeFade } from './hooks.ts';
import type { TodayButton } from './view.ts';
import { C, S } from './styles.ts';
import { todayBtn } from './chrome.ts';
import type { Translate } from './types.ts';

/**
 * The six things, most urgent first. Each press goes to the next item of its kind; the first is always amber. In
 * the city they wear the game chrome and the button whose layer is on shows pressed.
 */
export function TodayBar({ buttons, t, onPress, oneRow, active, chrome }: {
  buttons: TodayButton[]; t: Translate; onPress(cat: TodayButton['cat']): void;
  /** One scrolling row with the hard-edged chrome (over the city). */ oneRow?: boolean;
  /** The button whose layer is shown now. */ active?: TodayButton['cat'];
  /** The game chrome without the one-row layout (the list view). */ chrome?: boolean;
}) {
  const ul = useRef<HTMLUListElement>(null);
  const fade = useEdgeFade(ul);
  return (
    <ul ref={ul} style={oneRow ? { ...S.bar, flexWrap: 'nowrap', overflowX: 'auto', margin: 0, padding: '2px 2px 6px', scrollbarWidth: 'none', ...fade } : S.bar} aria-label={t('td.label')} data-dshu-today="">
      {buttons.map((b) => (
        <li key={b.cat} style={oneRow ? { flex: 'none' } : undefined}>
          <button type="button" style={oneRow || chrome ? todayBtn(b.amber, active === b.cat) : b.amber ? { ...S.btn, background: 'rgba(240,160,32,.16)', borderColor: C.wait, color: C.wait, fontWeight: 600 } : S.btn}
            aria-pressed={oneRow ? active === b.cat : undefined} aria-disabled={b.count === 0} title={b.title} data-dshu-local={b.local || undefined} onClick={() => b.count > 0 && onPress(b.cat)}>
            {b.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
