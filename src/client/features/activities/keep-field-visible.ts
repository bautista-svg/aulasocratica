// D09: on phones the sticky "Cambios sin guardar" bar sits above the bottom tab bar; together they
// cover ~130 px. These helpers keep the field being edited above them:
// - while typing (or when the bar appears) the page scrolls just enough to show the field;
// - while the on-screen keyboard is open the save bar hides (it would sit on top of the keyboard
//   on browsers that resize the page, covering the field), and comes back when it closes.
import { useEffect, useState, type RefObject } from "react";

const GAP = 12;
/** Rows of a tall textarea that must stay visible (the caret is usually near its end, but not always). */
const MIN_VISIBLE = 120;

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "file", "range", "color"].includes(el.type);
}

/** True while the on-screen keyboard is up (the visual viewport is much shorter than the window). */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setOpen(isTextField(document.activeElement) && vv.height < window.innerHeight - 150);
    vv.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      vv.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return open;
}

/**
 * Scrolls the window so the focused text field inside `root` is not under the sticky `bar`
 * (when visible) or under whatever the bar's `bottom` offset leaves room for (the phone tab bar).
 */
export function useKeepFieldVisible(root: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>, barVisible: boolean) {
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = document.activeElement;
        if (!isTextField(el) || !root.current?.contains(el)) return;
        const vv = window.visualViewport;
        let limit = vv ? vv.offsetTop + vv.height : window.innerHeight;
        const b = bar.current;
        if (b) {
          const r = b.getBoundingClientRect();
          if (barVisible && r.height > 0) limit = Math.min(limit, r.top);
          else {
            // Hidden bar: its sticky `bottom` (tab bar height on phones, 16 px on desktop) is still covered.
            const offset = parseFloat(getComputedStyle(b).bottom) || 0;
            limit = Math.min(limit, window.innerHeight - offset);
          }
        }
        const r = el.getBoundingClientRect();
        const room = limit - GAP - Math.max(0, r.top);
        const needed = r.height <= room ? r.bottom : r.top + Math.min(r.height, MIN_VISIBLE);
        const delta = needed + GAP - limit;
        if (delta > 0) window.scrollBy({ top: delta });
      });
    };
    const node = root.current;
    node?.addEventListener("focusin", check);
    node?.addEventListener("input", check);
    window.visualViewport?.addEventListener("resize", check);
    // The bar just appeared (first change): the field may be under it now.
    if (barVisible) check();
    return () => {
      cancelAnimationFrame(frame);
      node?.removeEventListener("focusin", check);
      node?.removeEventListener("input", check);
      window.visualViewport?.removeEventListener("resize", check);
    };
  }, [root, bar, barVisible]);
}
