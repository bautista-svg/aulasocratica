// Small hooks for the student page: drafts that survive a reload, the on-screen keyboard
// inset for the sticky composer, and the document title.
import { useCallback, useEffect, useRef, useState } from "react";

const read = (key: string): string => {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const write = (key: string, value: string) => {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* storage full or blocked: the draft still lives in memory */
  }
};

/** Draft kept in sessionStorage (per tab) so a reload never loses what the student wrote. */
export function useDraft(key: string): [string, (v: string | ((prev: string) => string)) => void, () => void] {
  const [value, setValue] = useState(() => read(key));
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(read(key));
    }
  }, [key]);
  const set = useCallback(
    (v: string | ((prev: string) => string)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? v(prev) : v;
        write(keyRef.current, next);
        return next;
      });
    },
    [],
  );
  const clear = useCallback(() => {
    write(keyRef.current, "");
    setValue("");
  }, []);
  return [value, set, clear];
}

export const draftPrefix = (token: string) => `as-draft:${token}:`;
export const draftKey = (token: string, code: string, field: string) => `${draftPrefix(token)}${code}:${field}`;

/** Forgets everything this tab kept for the link (drafts, step, notices) — "No soy <nombre>". */
export function clearDrafts(token: string) {
  try {
    const prefixes = [draftPrefix(token), `as-closing:${token}:`, `as-new:${token}:`];
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export function readFlag(key: string): boolean {
  return read(key) === "1";
}
export function writeFlag(key: string, on: boolean) {
  write(key, on ? "1" : "");
}

/**
 * Keeps `--kb` on <html> equal to the part of the layout viewport hidden by the on-screen
 * keyboard, so `bottom: var(--kb)` keeps the composer above it (iOS / Android).
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        root.style.setProperty("--kb", `${inset > 60 ? inset : 0}px`);
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--kb");
    };
  }, []);
}

/** Title + noindex for the student page (links are private to a class). */
export function useStudentHead(title: string | null) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} — Aula Socrática` : "Actividad — Aula Socrática";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    const prevContent = meta.content;
    meta.content = "noindex, nofollow";
    return () => {
      document.title = prev;
      if (created) meta?.remove();
      else if (meta) meta.content = prevContent;
    };
  }, [title]);
}
