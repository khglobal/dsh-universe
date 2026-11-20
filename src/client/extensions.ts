// Extension points of the city panel (docs/ARCHITECTURE.md). Other parts of the plugin register here at module
// load; the panel reads the registry when it mounts. Nothing here is a public API outside this plugin.
import type { ComponentType } from 'react';
import type { PlacementState, Store, UCapabilities } from '@dsh-universe/model';
import type { Overlay } from '@dsh-universe/renderer';
import type { Translate } from './types.ts';
import type { Light } from './prefs.ts';

/** What a view of one place (a building's interior, a civic building's floors) gets. */
export interface PlaceViewProps {
  placeId: string;
  store: Store;
  placement: PlacementState;
  T: number;
  titles: Record<string, string>;
  t: Translate;
  lang: string;
  /** Back to the city. */
  close(): void;
  /** Opens a session (absent when the host cannot). */
  onOpen?(sessionId: string): void;
  /** What the platform provides (floors it cannot fill show "not provided"). */
  caps?: UCapabilities;
  /** Day or night, as the city's toolbar sets it (auto: the host's theme). */
  light?: Light;
}
export interface PlaceView {
  id: string;
  /** Whether this view can show the place (`b:<session>`, `town`, `station`, `conn:<id>`, `model:<name>` …). */
  matches(placeId: string): boolean;
  Component: ComponentType<PlaceViewProps>;
}

const placeViews: PlaceView[] = [];
/** Registers a place view; the first that matches a place is used. Returns its removal. */
export function registerPlaceView(v: PlaceView): () => void {
  placeViews.push(v);
  return () => { const i = placeViews.indexOf(v); if (i >= 0) placeViews.splice(i, 1); };
}
export const placeViewFor = (placeId: string): PlaceView | undefined => placeViews.find((v) => v.matches(placeId));

/** Overlays are made per city view (each panel mounts its own). */
export type OverlayFactory = (o: { t: Translate; lang: string }) => Overlay;
const overlays: OverlayFactory[] = [];
export function registerOverlay(f: OverlayFactory): () => void {
  overlays.push(f);
  return () => { const i = overlays.indexOf(f); if (i >= 0) overlays.splice(i, 1); };
}
export const overlayFactories = (): readonly OverlayFactory[] => overlays;
