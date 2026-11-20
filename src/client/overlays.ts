// The data views and the balloon's badge, registered with the city panel (docs/ARCHITECTURE.md, extension point 2).
// Numbers and durations follow the interface language.
import { createDataViews, createPlanBlueprints, createSquareBadge } from '@dsh-universe/renderer';
import { registerOverlay } from './extensions.ts';
import { clock, duration, tokens } from './format.ts';

// Order matters: the blueprints are part of the city, so a data view greys them with it.
registerOverlay(() => createPlanBlueprints());
registerOverlay(({ t, lang }) => createDataViews({ t, tokens: (n) => tokens(n, lang), duration: (ms) => duration(ms, t), clock: (x) => clock(x, lang) }));
registerOverlay(() => createSquareBadge());
