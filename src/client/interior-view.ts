// Registers the inside view (phase 3) as the panel's view of a place: every building that has floors (session
// towers, the town hall, station, school, library, fire station, connectors and power stations). Plugin shops are
// one-room houses with nothing inside to show.
import { registerPlaceView } from './extensions.ts';
import { InteriorView } from './Interior.tsx';
import { interiorMatches } from './interior-text.ts';

registerPlaceView({ id: 'interior', matches: interiorMatches, Component: InteriorView });
