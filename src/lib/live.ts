/**
 * When the next prices should land. Blizzard refreshes each auction house about hourly (the snapshot's Last-Modified
 * time, read from meta.json), and Goldline publishes shortly after: the expected delay is the one observed for the
 * current snapshot (our publish time minus Blizzard's), bounded to 1-45 minutes, else 15 minutes. All in unix seconds.
 */
export function nextUpdate(snapshot: number | null, published: number | null, now: number): { at: number; due: boolean } | null {
  if (snapshot == null || !Number.isFinite(snapshot)) return null;
  const observed = published != null && Number.isFinite(published) ? published - snapshot : NaN;
  const lag = observed >= 60 && observed <= 2_700 ? observed : 900;
  let at = snapshot + 3_600 + lag;
  // If several hours were missed, aim at the next hourly slot after now rather than one long gone.
  while (at + 3_600 < now) at += 3_600;
  return { at, due: now >= at };
}

/** "mm:ss" for a countdown (never negative). */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
