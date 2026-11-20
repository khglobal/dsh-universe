// #29: a scene stepped on its animation clock (retimeScene) is the same picture as one built for that moment, on the
// sample day and the busy day (towers at work, the square full of placards), whenever stepping applies at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '@dsh-universe/model';
import { buildScene, retimeScene } from '@dsh-universe/renderer';
import { createArtKit } from '@dsh-universe/art';
import { dshSample } from '../fixtures/dsh-sample.ts';
import { stressDay } from '../fixtures/stress.ts';

const midnight = new Date(2026, 10, 18).getTime();
for (const [name, fx] of [['sample', dshSample(midnight, 'en')], ['busy', stressDay(midnight, 'many', 'en')], ['errors', stressDay(midnight, 'errors', 'en')]] as const) {
  test(`retime: ${name} day`, () => {
    const store = createStore(); store.applyAll(fx.events);
    const inp = { store, placement: fx.placement!, T: fx.now, live: true, templateTags: createArtKit().buildingTags, names: { town: 'T', station: 'S', fire: 'F', school: 'K', library: 'L' }, night: false };
    let stepped = 0;
    for (const T of [fx.now, fx.now - 3600_000, fx.now - 2 * 3600_000]) for (const [t0, t1] of [[1, 2], [4.5, 9.75], [30, 31]]) {
      const r = retimeScene(buildScene({ ...inp, T, time: t0 }), t1);
      if (!r) continue;
      stepped++;
      assert.deepEqual(r, buildScene({ ...inp, T, time: t1 }), `${name} T-${(fx.now - T) / 3600_000}h ${t0} → ${t1}`);
    }
    if (name !== 'errors') assert.ok(stepped > 0, 'stepping applied at least once');
  });
}
