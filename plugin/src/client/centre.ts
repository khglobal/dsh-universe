// What Enter opens in the city when the camera was not sent anywhere (#19): of the places whose picture covers the
// centre mark, the one whose picture is centred nearest to it. The topmost sprite at the exact centre was often a
// session tower standing in front of the place the member had centred (Agent Academy, Error Recovery).

/** A hit area in screen pixels: [left, top, right, bottom]. */
export interface ScreenHit { id: string; r: readonly [number, number, number, number] }

export function centrePick(hits: readonly ScreenHit[], cx: number, cy: number): string | undefined {
  const over = hits.filter((h) => h.r[0] <= cx && cx <= h.r[2] && h.r[1] <= cy && cy <= h.r[3]);
  const places = over.filter((h) => !h.id.startsWith('agent:'));
  const pool = places.length ? places : over;
  let best: ScreenHit | undefined, bestD = Infinity;
  for (const h of pool) {
    // The camera centres a place on its picture's middle: the picture whose middle is nearest the mark is the one
    // centred, and a tall tower that merely reaches over the mark loses.
    const d = Math.hypot(cx - (h.r[0] + h.r[2]) / 2, cy - (h.r[1] + h.r[3]) / 2);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best?.id;
}
