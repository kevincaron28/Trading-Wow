/**
 * Keeps the field being typed in above the on-screen keyboard. Android shrinks the page when the keyboard opens
 * (adjustResize, and Capacitor's keyboard inset); here the tab bar is hidden to give that room back and the focused
 * field is scrolled into view when it ended up out of sight.
 */

/** A page this much shorter than its tallest, while a field has the focus, has the keyboard open (CSS pixels). */
export const KEYBOARD_MIN = 150;

const TEXT_FIELDS = "textarea, [contenteditable='true'], input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='range'])";

export function keyboardOpen(height: number, tallest: number, typing: boolean): boolean {
  return typing && tallest - height > KEYBOARD_MIN;
}

/** Is any part of the field outside the visible page? */
export function outOfSight(rect: { top: number; bottom: number }, height: number, margin = 8): boolean {
  return rect.top < margin || rect.bottom > height - margin;
}

export function watchKeyboard(): () => void {
  const viewport = window.visualViewport;
  const height = () => Math.min(window.innerHeight, viewport?.height ?? Infinity);
  let width = window.innerWidth;
  let tallest = height();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const field = () => {
    const el = document.activeElement;
    return el instanceof HTMLElement && el.matches(TEXT_FIELDS) ? el : null;
  };
  const update = () => {
    // Turning the phone changes both sizes: start measuring again.
    if (window.innerWidth !== width) {
      width = window.innerWidth;
      tallest = height();
    }
    tallest = Math.max(tallest, height());
    document.documentElement.toggleAttribute("data-keyboard", keyboardOpen(height(), tallest, !!field()));
    clearTimeout(timer);
    // After the layout settled (the tab bar just went away).
    timer = setTimeout(() => {
      const el = field();
      if (el && outOfSight(el.getBoundingClientRect(), height())) el.scrollIntoView({ block: "center" });
    }, 120);
  };
  window.addEventListener("resize", update);
  viewport?.addEventListener("resize", update);
  document.addEventListener("focusin", update);
  document.addEventListener("focusout", update);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("resize", update);
    viewport?.removeEventListener("resize", update);
    document.removeEventListener("focusin", update);
    document.removeEventListener("focusout", update);
    document.documentElement.removeAttribute("data-keyboard");
  };
}
