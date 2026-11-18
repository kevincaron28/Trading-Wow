/**
 * Android back button: the most recently opened overlay (search, sheet) closes first. Screens register a
 * handler while they are open; App.tsx handles the rest (go to Watchlist, then leave the app).
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
  close();
  return true;
}
