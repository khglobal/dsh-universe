import type { ReactNode } from 'react';
import type { HistoryDay, USchedule, UInventory } from '@dsh-universe/model';
import { clock } from './format.ts';
import { C, S, stateColor } from './styles.ts';
import type { PlaceRow, Row, Section } from './view.ts';
import type { Translate } from './types.ts';

export interface ListProps {
  t: Translate; lang: string; T: number;
  sections: Section[]; places: PlaceRow[]; schedules: USchedule[] | null; plugins: UInventory['plugins'];
  /** The 14 days ending with the day shown (model `historyWindow`): the last is today, counted live. */
  days: HistoryDay[];
  focus?: string;
  onOpen?(row: Row): void;
  onSeen(row: Row): void;
}

const rowId = (id: string) => 'dshu-row-' + id;

function SessionRow({ row, t, focus, onOpen, onSeen }: { row: Row; t: Translate; focus?: string; onOpen?(r: Row): void; onSeen(r: Row): void }) {
  return (
    <div id={rowId(row.id)} role="listitem" className="dshu-srow" style={{ ...S.row, ...(focus === row.id ? { outline: `2px solid ${C.wait}`, outlineOffset: -2 } : {}) }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: stateColor(row.state) }}>{row.stateText}</span>
      <span style={{ minWidth: 0, paddingLeft: row.sub ? 16 : 0 }}>
        <div style={S.title}>{row.title}</div>
        <div style={S.small}>{[row.context, row.detail].filter(Boolean).join(' · ')}</div>
      </span>
      <span className="dshu-acts" style={S.acts}>
        {onOpen && <button type="button" style={S.rowBtn} onClick={() => onOpen(row)}>{row.waiting ? t('act.confirm') : t('act.open')}</button>}
        {row.review && <button type="button" style={S.rowBtn} onClick={() => onSeen(row)}>{t('act.seen')}</button>}
      </span>
      <span style={S.nums}>{row.tokens}<br />{row.duration}</span>
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <h2 style={S.h2}><span>{title}</span><span>{count}</span></h2>
      <div style={S.card} role="list">{children}</div>
    </section>
  );
}

/** The complete equivalent of the city: every group and every place, each row a real button. */
export function ListView(p: ListProps) {
  const none = <div style={S.empty}>{p.t('li.none')}</div>;
  const [first, ...rest] = p.sections;
  const group = (s: Section) => (
    <Group key={s.id} title={s.title} count={s.rows.length}>
      {s.rows.length ? s.rows.map((r) => <SessionRow key={r.id} row={r} t={p.t} focus={p.focus} onOpen={p.onOpen} onSeen={p.onSeen} />) : none}
    </Group>
  );
  return (
    <div>
      {first && group(first)}
      {rest.slice(0, 2).map(group)}
      {p.schedules && (
        <Group title={p.t('li.auto')} count={p.schedules.length}>
          {p.schedules.length ? p.schedules.map((s) => {
            const ran = s.runs.filter((r) => r.at <= p.T).sort((a, b) => b.at - a.at)[0];
            const text = s.status === 'paused' ? p.t('sch.paused') : s.nextAt !== undefined && s.nextAt > p.T ? p.t('sch.next', { t: clock(s.nextAt, p.lang) }) : '';
            return (
              <div key={s.id} id={rowId('sch:' + s.id)} role="listitem" style={{ ...S.row, ...(p.focus === 'sch:' + s.id ? { outline: `2px solid ${C.wait}`, outlineOffset: -2 } : {}) }}>
                <span style={{ fontSize: 12, color: C.muted }}>{ran ? clock(ran.at, p.lang) : ''}</span>
                <span style={{ minWidth: 0 }}><div style={S.title}>{s.title}</div><div style={S.small}>{[text, ran ? p.t('sch.ran', { t: clock(ran.at, p.lang) }) : ''].filter(Boolean).join(' · ')}</div></span>
                <span />
              </div>
            );
          }) : none}
        </Group>
      )}
      {rest.slice(2).map(group)}
      <Group title={p.t('li.places')} count={p.places.length}>
        {p.places.map((pl) => (
          <div key={pl.id} id={rowId(pl.id)} role="listitem" style={{ ...S.row, ...(p.focus === pl.id ? { outline: `2px solid ${C.wait}`, outlineOffset: -2 } : {}) }}>
            <span style={{ fontSize: 12, color: C.muted }}>{p.t('pl.in', { n: pl.inside })}</span>
            <span style={{ minWidth: 0 }}><div style={S.title}>{pl.name}</div><div style={S.small}>{pl.floors}</div></span>
            <span />
          </div>
        ))}
      </Group>
      {p.plugins && (
        <Group title={p.t('li.plugins')} count={p.plugins.length}>
          {p.plugins.length ? p.plugins.map((pl) => (
            <div key={pl.id} role="listitem" style={S.row}>
              <span style={{ fontSize: 12, color: pl.enabled ? C.done : C.idle }}>{pl.enabled ? p.t('pg.on') : p.t('pg.off')}</span>
              <span style={S.title}>{pl.id}</span><span />
            </div>
          )) : none}
        </Group>
      )}
      {p.days.some((d) => !d.today && d.known) && (
        <Group title={p.t('li.days')} count={p.days.filter((d) => !d.today).length}>
          {p.days.filter((d) => !d.today).reverse().map((d) => (
            <div key={d.day} role="listitem" style={S.row}>
              <span style={{ fontSize: 12, color: C.muted }}>{d.day}</span>
              <span style={d.known ? S.small : { ...S.small, color: C.muted }}>{d.known ? p.t('li.dayRow', { n: d.sessions, f: d.failed }) : p.t('li.dayUnknown')}</span><span />
            </div>
          ))}
        </Group>
      )}
    </div>
  );
}

export { rowId };
