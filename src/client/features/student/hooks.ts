// Small hooks for the student page: drafts that survive a reload, a new tab or closing the
// browser (localStorage on this device, cleared when sent or on "No soy <nombre>"), and the
// on-screen keyboard inset for the sticky composer.
import { useCallback, useEffect, useRef, useState } from "react";

/** Same lifetime as the device cookie: an untouched draft is forgotten after 30 days. */
const DRAFT_TTL_MS = 30 * 86_400_000;
const PREFIXES = ["as-draft:", "as-closing:", "as-new:"];

interface Stored {
  v: string;
  t: number;
}

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): string {
  if (!raw) return "";
  try {
    const s = JSON.parse(raw) as Stored;
    if (typeof s?.v !== "string" || typeof s.t !== "number") return "";
    return Date.now() - s.t > DRAFT_TTL_MS ? "" : s.v;
  } catch {
    return "";
  }
}

const read = (key: string): string => {
  try {
    const value = parse(local()?.getItem(key) ?? null);
    if (value) return value;
    // Drafts written by an older version lived in sessionStorage (this tab only): move them.
    const legacy = session()?.getItem(key) ?? "";
    if (legacy) {
      write(key, legacy);
      return legacy;
    }
    return "";
  } catch {
    return "";
  }
};

function write(key: string, value: string) {
  try {
    session()?.removeItem(key);
    if (value) local()?.setItem(key, JSON.stringify({ v: value, t: Date.now() } satisfies Stored));
    else local()?.removeItem(key);
  } catch {
    /* storage full or blocked: the draft still lives in memory */
  }
}

/** Forgets drafts nobody touched in 30 days (runs once per page load). */
function purgeExpired() {
  const store = local();
  if (!store) return;
  try {
    for (let i = store.length - 1; i >= 0; i--) {
      const k = store.key(i);
      if (k && PREFIXES.some((p) => k.startsWith(p)) && !parse(store.getItem(k))) store.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
if (typeof window !== "undefined") purgeExpired();

/**
 * Draft kept on this device (localStorage) so a reload, another tab or closing the browser never
 * loses what the student wrote. Other tabs of the same work see the changes.
 */
export function useDraft(key: string): [string, (v: string | ((prev: string) => string)) => void, () => void] {
  const [value, setValue] = useState(() => read(key));
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(read(key));
    }
  }, [key]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyRef.current) setValue(parse(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const set = useCallback((v: string | ((prev: string) => string)) => {
    setValue((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      write(keyRef.current, next);
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    write(keyRef.current, "");
    setValue("");
  }, []);
  return [value, set, clear];
}

export const draftPrefix = (token: string) => `as-draft:${token}:`;
export const draftKey = (token: string, code: string, field: string) => `${draftPrefix(token)}${code}:${field}`;

export type DraftField = "initial" | "chat" | "final" | "reflection";

/** Fields of this work with text written on this device that was not sent yet. */
export function unsentDrafts(token: string, code?: string): DraftField[] {
  const prefix = code ? `${draftPrefix(token)}${code}:` : draftPrefix(token);
  const out = new Set<DraftField>();
  const store = local();
  try {
    for (let i = 0; store && i < store.length; i++) {
      const k = store.key(i);
      if (!k?.startsWith(prefix)) continue;
      const field = k.slice(k.lastIndexOf(":") + 1) as DraftField;
      const v = parse(store.getItem(k));
      const filled = field === "reflection" ? Object.values(safeJson(v)).some((a) => typeof a === "string" && a.trim()) : v.trim();
      if (filled) out.add(field);
    }
  } catch {
    /* ignore */
  }
  return [...out];
}

function safeJson(v: string): Record<string, unknown> {
  try {
    const o = v ? (JSON.parse(v) as unknown) : {};
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Forgets everything this device kept for the link (drafts, step, notices) — "No soy <nombre>". */
export function clearDrafts(token: string, code?: string) {
  const prefixes = code
    ? [`${draftPrefix(token)}${code}:`, `as-closing:${token}:${code}`, `as-new:${token}:${code}`]
    : [draftPrefix(token), `as-closing:${token}:`, `as-new:${token}:`];
  for (const store of [local(), session()]) {
    try {
      for (let i = (store?.length ?? 0) - 1; store && i >= 0; i--) {
        const k = store.key(i);
        if (k && prefixes.some((p) => k.startsWith(p))) store.removeItem(k);
      }
    } catch {
      /* ignore */
    }
  }
}

export function readFlag(key: string): boolean {
  return read(key) === "1";
}
export function writeFlag(key: string, on: boolean) {
  write(key, on ? "1" : "");
}

/** Remembers on this device that a link worked, to explain a later "not found" (link replaced). */
const SEEN_KEY = "as-seen-links";
export function rememberLink(token: string) {
  try {
    const store = local();
    if (!store) return;
    const list = (JSON.parse(store.getItem(SEEN_KEY) ?? "[]") as unknown[]).filter((t): t is string => typeof t === "string");
    if (list[0] === token) return;
    store.setItem(SEEN_KEY, JSON.stringify([token, ...list.filter((t) => t !== token)].slice(0, 30)));
  } catch {
    /* ignore */
  }
}
export function linkWasSeen(token: string): boolean {
  try {
    const list = JSON.parse(local()?.getItem(SEEN_KEY) ?? "[]") as unknown;
    return Array.isArray(list) && list.includes(token);
  } catch {
    return false;
  }
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
