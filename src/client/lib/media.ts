import { useSyncExternalStore } from "react";

/** Tailwind's `lg` breakpoint (64rem). */
export const LG_QUERY = "(min-width: 64rem)";

/**
 * Whether a media query matches, kept in sync with the viewport. Lets a component render only the
 * layout that is visible (instead of rendering both and hiding one with CSS).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}
