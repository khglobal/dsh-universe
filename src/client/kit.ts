// Which art kit the panel draws with. The art package is proprietary and kept separable: without it, swap this one
// line for `createStubKit()` from the renderer and the city draws as grey boxes.
import { createArtKit } from '@dsh-universe/art';
import type { ArtKit } from '@dsh-universe/renderer';

export const makeKit = (): ArtKit => createArtKit();
