import { useEffect, useState } from "preact/hooks";
import { useStore } from "../app/store";
import { t } from "../lib/i18n";
import { countdown, nextUpdate } from "../lib/live";

/** "next ≈ mm:ss" until the expected update, then "checking for new prices…" (the app polls while open). */
export function NextUpdate({ snapshot, published }: { snapshot: number; published: number | null }) {
  const s = useStore();
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  const next = nextUpdate(snapshot, published, now);
  if (!next) return null;
  return next.due ? <span class="live-dot">{t(s.lang, "checkingPrices")}</span> : <span>{t(s.lang, "nextUpdate")} {countdown(next.at - now)}</span>;
}
