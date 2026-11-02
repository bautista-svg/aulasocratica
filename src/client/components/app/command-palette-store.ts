// Open state of the search (Ctrl K), kept outside React so any screen can open it.
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openPalette() {
  open = true;
  emit();
}

export function setPaletteOpen(v: boolean) {
  open = v;
  emit();
}

export function usePaletteOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => false,
  );
}
