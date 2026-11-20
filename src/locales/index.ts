import { PLUGIN_SLUG } from '@dsh-universe/adapter-dsh';
export { zh } from './zh.ts';
export { en } from './en.ts';
/** The locale namespace and the panel key (also the sidebar entry id). */
export const NS = PLUGIN_SLUG;
export const PANEL = PLUGIN_SLUG;
export type TextKey = keyof typeof import('./zh.ts').zh;
