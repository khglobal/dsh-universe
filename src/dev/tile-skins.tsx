// Dev only (`?tiles=skins`): the tile in frames that imitate a host workbench's three skins (3D, 90s web,
// glass) at the workbench's real cell sizes (96 px cells, 16 px gaps, 18 px padding), light and dark. The token values
// are copied from workbench-home's tokens.ts and skins.ts for review; nothing here ships in the plugin.
import type { ReactNode } from 'react';

type Skin = 'volume' | 'retro' | 'glass';
const SIZES = [{ w: 4, h: 2 }, { w: 2, h: 2 }, { w: 4, h: 1 }] as const;

const PAGE: Record<Skin, Record<'light' | 'dark', string>> = {
  volume: { light: '#EEF1F5', dark: '#0F131A' },
  retro: { light: 'radial-gradient(circle,#FFFF00 0 1px,transparent 1.6px) 0 0/40px 40px,radial-gradient(circle,#FFFFFF 0 1px,transparent 1.4px) 20px 20px/40px 40px,#000080', dark: 'radial-gradient(circle,#FFFF00 0 1px,transparent 1.6px) 0 0/40px 40px,#000080' },
  glass: { light: 'radial-gradient(60% 50% at 15% 10%,#A5B4FC,transparent 70%),radial-gradient(50% 60% at 85% 20%,#F0ABFC,transparent 70%),radial-gradient(70% 60% at 50% 100%,#67E8F9,transparent 70%),#EEF2FF', dark: 'radial-gradient(60% 50% at 15% 10%,#312E81,transparent 70%),radial-gradient(50% 60% at 85% 20%,#701A75,transparent 70%),radial-gradient(70% 60% at 50% 100%,#0E7490,transparent 70%),#0B0B1E' },
};
const VARS: Record<Skin, Record<'light' | 'dark', Record<string, string>>> = {
  volume: {
    light: { '--awb-ink': '#18181B', '--awb-muted': '#71717A', '--awb-warn': '#8F540C', '--awb-r-plate': '22px', '--awb-r-widget': '28px', '--awb-sh0': 'inset 0 1px 2px rgb(0 0 0 / .1)', '--awb-surface': '#FFFFFF', '--awb-sh1': '0 1px 1px rgb(15 35 80 / .04),0 12px 28px -10px rgb(15 35 80 / .16),inset 0 1px 0 rgb(255 255 255 / .9)', '--awb-edge': 'rgb(255 255 255 / .9)' },
    dark: { '--awb-ink': '#F4F4F5', '--awb-muted': '#A1A1AA', '--awb-warn': '#F5C07A', '--awb-r-plate': '22px', '--awb-r-widget': '28px', '--awb-sh0': 'inset 0 1px 2px rgb(0 0 0 / .1)', '--awb-surface': '#1C212B', '--awb-sh1': '0 1px 1px rgb(0 0 0 / .3),0 14px 30px -10px rgb(0 0 0 / .6),inset 0 1px 0 rgb(255 255 255 / .08)', '--awb-edge': 'rgb(255 255 255 / .08)' },
  },
  retro: {
    light: { '--awb-ink': '#000000', '--awb-muted': '#202020', '--awb-warn': '#800000', '--awb-r-plate': '0px', '--awb-r-widget': '0px', '--awb-sh0': 'inset -1px -1px 0 #fff,inset 1px 1px 0 #000,inset -2px -2px 0 #DFDFDF,inset 2px 2px 0 #808080', '--awb-surface': '#C0C0C0', '--awb-sh1': 'inset -1px -1px 0 #000,inset 1px 1px 0 #fff,inset -2px -2px 0 #808080,inset 2px 2px 0 #DFDFDF,4px 4px 0 rgb(0 0 0 / .5)', '--awb-edge': 'transparent' },
    dark: { '--awb-ink': '#000000', '--awb-muted': '#202020', '--awb-warn': '#800000', '--awb-r-plate': '0px', '--awb-r-widget': '0px', '--awb-sh0': 'inset -1px -1px 0 #fff,inset 1px 1px 0 #000,inset -2px -2px 0 #DFDFDF,inset 2px 2px 0 #808080', '--awb-surface': '#C0C0C0', '--awb-sh1': 'inset -1px -1px 0 #000,inset 1px 1px 0 #fff,inset -2px -2px 0 #808080,inset 2px 2px 0 #DFDFDF,4px 4px 0 rgb(0 0 0 / .5)', '--awb-edge': 'transparent' },
  },
  glass: {
    light: { '--awb-ink': '#14152B', '--awb-muted': '#3B3E63', '--awb-warn': '#B45309', '--awb-r-plate': '24px', '--awb-r-widget': '32px', '--awb-surface': 'rgb(255 255 255 / .42)', '--awb-sh1': '0 8px 32px rgb(31 38 135 / .16),inset 0 1px 0 rgb(255 255 255 / .7)', '--awb-edge': 'rgb(255 255 255 / .65)' },
    dark: { '--awb-ink': '#F5F3FF', '--awb-muted': '#C4B5FD', '--awb-warn': '#FCD34D', '--awb-r-plate': '24px', '--awb-r-widget': '32px', '--awb-surface': 'rgb(255 255 255 / .09)', '--awb-sh1': '0 8px 32px rgb(0 0 0 / .4),inset 0 1px 0 rgb(255 255 255 / .12)', '--awb-edge': 'rgb(255 255 255 / .18)' },
  },
};
const FONT: Record<Skin, string> = {
  volume: '14px/1.4 -apple-system,"PingFang SC",system-ui,sans-serif',
  retro: '15px/1.4 "Times New Roman",Times,"Songti SC","SimSun",serif',
  glass: '14px/1.4 -apple-system,"PingFang SC",system-ui,sans-serif',
};

export function TileSkins({ render }: { render(size: { w: number; h: number }, theme: 'light' | 'dark'): ReactNode }) {
  const skin = (new URLSearchParams(location.search).get('skin') ?? 'volume') as Skin;
  const mode = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
  return (
    <div data-skin={skin} style={{ ...VARS[skin][mode], background: PAGE[skin][mode], font: FONT[skin], padding: 24, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', minHeight: '100vh', boxSizing: 'border-box', color: 'var(--awb-ink)' } as never}>
      {SIZES.map((s) => (
        <section key={s.w + 'x' + s.h} data-size={s.w + 'x' + s.h} style={{
          width: s.w * 96 + (s.w - 1) * 16, height: s.h * 96 + (s.h - 1) * 16, boxSizing: 'border-box', padding: 18, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          borderRadius: 'var(--awb-r-widget)', background: 'var(--awb-surface)', boxShadow: 'var(--awb-sh1)', border: skin === 'retro' ? 0 : '1px solid var(--awb-edge)',
          ...(skin === 'glass' ? { backdropFilter: 'blur(24px) saturate(1.6)' } : {}),
        }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{render(s, mode)}</div>
        </section>
      ))}
    </div>
  );
}
