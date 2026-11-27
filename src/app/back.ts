/**
 * Android back button: the most recently opened overlay (search, sheet, page) closes first. Screens register a
 * handler while they are open; App.tsx handles the rest (go to Market, then press Back twice to leave the app).
 */
const stack: (() => void)[] = [];

/** Register a close handler; call the returned function when the overlay closes by other means. */
export function onBack(close: () => void): () => void {
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Run the newest handler. Returns false when nothing was open. */
export function handleBack(): boolean {
  const close = stack.pop();
  if (!close) return false;
  exitArmedAt = -Infinity;
  close();
  return true;
}

/** How long "Press Back again to exit" stays valid, milliseconds. */
export const EXIT_WINDOW_MS = 2_000;
let exitArmedAt = -Infinity;

/** Back on the main screen: false the first time (show the hint), true on a second press inside the window. */
export function exitOnBack(now: number): boolean {
  const again = now - exitArmedAt <= EXIT_WINDOW_MS;
  exitArmedAt = again ? -Infinity : now;
  return again;
}
