// Guards for create buttons (D01): a double click must never create two records.
// - useSingleFlight: blocks synchronously on the first click (a ref, not `isPending`, which only
//   changes on the next render) and frees itself when the mutation settles or is reset.
// - newRequestId: one id per form; the server returns the first result for a repeated id.
import { useCallback, useEffect, useRef } from "react";

export function useSingleFlight(pending: boolean) {
  const busy = useRef(false);
  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending]);
  /** True when the caller may start now (and marks it as running); false while a previous start is running. */
  return useCallback(() => {
    if (busy.current || pending) return false;
    busy.current = true;
    return true;
  }, [pending]);
}

/** RFC 4122 v4 id (crypto.randomUUID is missing outside secure contexts, e.g. a LAN address over http). */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A request id that stays the same while the form is open and changes each time it opens. */
export function useRequestId(open: boolean): string {
  const id = useRef<string>("");
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) id.current = newRequestId();
  wasOpen.current = open;
  if (!id.current) id.current = newRequestId();
  return id.current;
}
