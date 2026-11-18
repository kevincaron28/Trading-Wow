import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./ptr.css";

const THRESHOLD = 70;
const MAX_PULL = 110;
const DAMP = 0.55;

/** Pull down from the top of the nearest `.content` scroller to refresh. Vertical drags only. */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => void | Promise<void>; children: ComponentChildren }) {
  const root = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const [anim, setAnim] = useState(false);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const busyRef = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const scroller = el.closest(".content") as HTMLElement | null;
    const top = () => (scroller ? scroller.scrollTop : window.scrollY);
    let startY = 0;
    let startX = 0;
    let active = false;
    let decided = false;
    let dist = 0;

    const reset = () => { active = false; decided = false; dist = 0; };
    const finish = async () => {
      const go = dist >= THRESHOLD && !busyRef.current;
      reset();
      setAnim(true);
      if (!go) { setPull(0); return; }
      busyRef.current = true;
      setBusy(true);
      setPull(THRESHOLD * DAMP + 8);
      try { await cb.current(); } catch { /* ignore */ }
      busyRef.current = false;
      setBusy(false);
      setPull(0);
    };

    const onStart = (e: TouchEvent) => {
      if (busyRef.current || e.touches.length !== 1 || top() > 0) return;
      startY = e.touches[0]!.clientY;
      startX = e.touches[0]!.clientX;
      active = true;
      decided = false;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0]!.clientY - startY;
      const dx = e.touches[0]!.clientX - startX;
      if (!decided) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        decided = true;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || top() > 0) { reset(); return; }
        setAnim(false);
      }
      if (top() > 0) { reset(); setPull(0); return; }
      dist = Math.max(0, dy);
      if (dist > 0 && e.cancelable) e.preventDefault();
      setPull(Math.min(MAX_PULL, dist * DAMP));
    };
    const onEnd = () => {
      if (!active) return;
      if (!decided) { reset(); return; }
      void finish();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const ready = pull >= THRESHOLD * DAMP;
  return (
    <div class="ptr" ref={root}>
      <div class={`ptr-indicator ${anim ? "anim" : ""}`} style={{ height: `${pull}px` }} aria-hidden="true">
        <span class={`ptr-icon ${busy ? "busy" : ""} ${ready && !busy ? "ready" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            {busy ? <path d="M21 12a9 9 0 1 1-3-6.7" /> : <path d="M12 5v14M6 13l6 6 6-6" />}
          </svg>
        </span>
      </div>
      <div class={`ptr-body ${anim ? "anim" : ""}`} style={{ transform: pull ? `translateY(${pull}px)` : undefined }}>
        {children}
      </div>
    </div>
  );
}
