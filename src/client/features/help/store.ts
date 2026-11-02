// Open state of the help assistant ("¿Dónde está…?"), so the menu, the search and any screen can
// open it, optionally with a question already typed.
import { useSyncExternalStore } from "react";

let state: { open: boolean; question: string } = { open: false, question: "" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openHelp(question?: unknown) {
  state = { open: true, question: typeof question === "string" ? question : "" };
  emit();
}

export function closeHelp() {
  state = { open: false, question: "" };
  emit();
}

export function useHelpState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
