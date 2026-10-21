// Observes two browser signals while the student works and reports them for the teacher:
// pasting text copied outside the activity, and leaving the page (tab/app hidden) for a
// while. Nothing is blocked and the pasted text itself is never sent — only its length.
// Leaving is measured with visibilitychange (hidden → visible), not window blur, so the
// address bar, permission prompts or devtools do not count.
import { useEffect, useRef } from "react";
import { AWAY_MIN_MS, isOutsidePaste } from "@shared/domain/alerts";
import { quoteAppears } from "@shared/domain/thinking-xray";
import { sendSignal } from "./api";

const MAX_COPIED = 20;
/** Opening one of the activity's files right before leaving is not "leaving". */
const MATERIAL_GRACE_MS = 3000;

export function useIntegritySignals(opts: {
  token: string;
  enabled: boolean;
  /** Text shown inside the activity (instructions, material) — copying it is not "outside". */
  materialText: string;
  /** Everything the student already wrote or read here (answers, messages). */
  insideTexts: () => string[];
}) {
  const copied = useRef<string[]>([]);
  const awaySince = useRef<number | null>(null);
  const awayAfterMaterial = useRef(false);
  const materialClickAt = useRef(0);
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!opts.enabled) return;

    const onCopy = () => {
      const sel = window.getSelection()?.toString() ?? "";
      const active = document.activeElement;
      const fromField =
        active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
          ? active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0)
          : "";
      const text = sel || fromField;
      if (text.trim()) copied.current = [text, ...copied.current].slice(0, MAX_COPIED);
    };

    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target.isContentEditable)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const { materialText, insideTexts, token } = latest.current;
      const inside = [materialText, ...insideTexts(), ...copied.current];
      if (!isOutsidePaste(text, inside)) return;
      sendSignal(token, {
        kind: "pasted_text",
        chars: Math.min(text.length, 200_000),
        fromMaterial: materialText ? quoteAppears(text.slice(0, 300), materialText) : false,
      });
    };

    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest("[data-activity-material]")) materialClickAt.current = Date.now();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (awaySince.current === null) {
          awaySince.current = Date.now();
          awayAfterMaterial.current = Date.now() - materialClickAt.current < MATERIAL_GRACE_MS;
        }
        return;
      }
      if (awaySince.current === null) return;
      const awayMs = Date.now() - awaySince.current;
      awaySince.current = null;
      if (awayMs >= AWAY_MIN_MS) {
        sendSignal(latest.current.token, {
          kind: "left_app",
          awayMs: Math.min(awayMs, 86_400_000),
          fromMaterial: awayAfterMaterial.current,
        });
      }
    };

    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCopy, true);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("cut", onCopy, true);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [opts.enabled]);
}
