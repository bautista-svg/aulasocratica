// Light or dark. Light is the default (classrooms, projectors, shared screens); a person who picks
// dark keeps it on this device. The choice lives on <html data-theme>, which styles.css reads.
import { useSyncExternalStore } from "react";
import { isAccent, type Accent } from "@shared/domain/accents";

export type Theme = "light" | "dark";

const KEY = "aula:theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0d0e14" : "#f6f6f9");
}

/** Called once before the first render, so the page paints in the saved theme and accent. */
export function initTheme() {
  apply(read());
  // The accent is one for the whole app: paint the last one this device saw, then ask for the current one.
  try {
    const last = localStorage.getItem(ACCENT_KEY);
    if (isAccent(last)) applyAccent(last);
  } catch {
    /* private mode */
  }
  void fetch("/api/settings/appearance", { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<{ accent: unknown }>) : null))
    .then((d) => {
      if (d && isAccent(d.accent)) applyAccent(d.accent);
    })
    .catch(() => {});
}

const ACCENT_KEY = "aula:accent";

/** Paints the accent color (and remembers it, so the next visit starts with it). */
export function applyAccent(accent: Accent) {
  document.documentElement.setAttribute("data-accent", accent);
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    /* private mode */
  }
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: it applies for this visit */
  }
  apply(theme);
  listeners.forEach((l) => l());
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore<Theme>(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"),
    () => "light",
  );
  return [theme, setTheme];
}
