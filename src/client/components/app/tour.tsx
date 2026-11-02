// Guided tours over the real interface: the screen dims, a window of light opens over the element
// to touch (marked with data-tour="…") and a small card says what it does. Each screen's tour
// shows once (useAutoTour); the "?" and "Recorrido guiado" start it again. The help assistant
// uses the same layer to point at the button it talked about (pointAt).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "@client/components/ui/button";
import { cn } from "@client/lib/cn";

export interface TourStep {
  /** data-tour value of the element to light up. */
  target: string;
  title: string;
  body: string;
}

interface TourState {
  steps: TourStep[];
  index: number;
  key: string | null;
}

let state: TourState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const SEEN = (key: string) => `aula:tour:${key}`;

function markSeen(key: string | null) {
  if (!key) return;
  try {
    localStorage.setItem(SEEN(key), "1");
  } catch {
    /* private mode: it may show again next visit */
  }
}

export function tourSeen(key: string): boolean {
  try {
    return localStorage.getItem(SEEN(key)) === "1";
  } catch {
    return true;
  }
}

export function startTour(steps: TourStep[], key: string | null = null) {
  // A screen's tour shows what is there now (a new workspace has no classes yet, a reader has no
  // "Publicar"); a single pointer always shows, and says so when the element is not on screen.
  const present = steps.length > 1 ? steps.filter((s) => visibleTarget(s.target)) : steps;
  const shown = present.length ? present : steps;
  if (!shown.length) return;
  state = { steps: shown, index: 0, key };
  emit();
}

/** Lights up one element with a short explanation (the help assistant's "Llevame"). */
export function pointAt(target: string, title: string, body: string) {
  startTour([{ target, title, body }]);
}

export function endTour() {
  markSeen(state?.key ?? null);
  state = null;
  emit();
}

function go(delta: number) {
  if (!state) return;
  const index = state.index + delta;
  if (index < 0) return;
  if (index >= state.steps.length) return endTour();
  state = { ...state, index };
  emit();
}

function useTourState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}

// The tour of the screen on view, so "Recorrido guiado" and the "?" can show it again.
let screenTour: { key: string; steps: () => TourStep[] } | null = null;

/** Starts a screen's tour the first time the person sees that screen (once `ready`). */
export function useAutoTour(key: string, steps: TourStep[], ready: boolean) {
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  useEffect(() => {
    const mine = { key, steps: () => stepsRef.current };
    screenTour = mine;
    return () => {
      if (screenTour === mine) screenTour = null;
    };
  }, [key]);
  useEffect(() => {
    if (!ready || tourSeen(key) || state) return;
    // Wait for any open dialog (Novedades, a form) to close first: both at once is confusing.
    let calm = 0;
    const t = setInterval(() => {
      if (state || tourSeen(key)) return clearInterval(t);
      calm = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') ? 0 : calm + 1;
      if (calm >= 2) {
        clearInterval(t);
        startTour(stepsRef.current, key);
      }
    }, 400);
    return () => clearInterval(t);
  }, [key, ready]);
}

/** "Recorrido guiado": this screen's tour, or the general one when the screen has none. */
export function restartTour(fallback: TourStep[]) {
  if (screenTour) startTour(screenTour.steps(), screenTour.key);
  else startTour(fallback);
}

function visibleTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;
const CARD_W = 300;
const GAP = 14;

export function TourLayer() {
  const tour = useTourState();
  const step = tour ? tour.steps[tour.index] : null;
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [cardH, setCardH] = useState(180);

  // Follow the element while the step is open (it may move: scrolling, a panel opening).
  useEffect(() => {
    if (!step) return;
    setBox(null);
    setMissing(false);
    let raf = 0;
    let scrolled = false;
    const started = performance.now();
    const loop = () => {
      const el = visibleTarget(step.target);
      if (el) {
        if (!scrolled) {
          scrolled = true;
          const r = el.getBoundingClientRect();
          if (r.top < 70 || r.bottom > window.innerHeight - 70) el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        const r = el.getBoundingClientRect();
        setBox((b) =>
          b && Math.abs(b.top - r.top) < 0.5 && Math.abs(b.left - r.left) < 0.5 && b.width === r.width && b.height === r.height
            ? b
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
        setMissing(false);
      } else if (performance.now() - started > 2500) {
        // Not on this screen (or hidden on this size): the card still says where it is.
        setBox(null);
        setMissing(true);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  });

  useEffect(() => {
    if (!step) return;
    nextRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (!tour || !step) return null;
  const total = tour.steps.length;
  const last = tour.index === total - 1;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const phone = vw < 640;
  let cardStyle: CSSProperties;
  if (!box) {
    cardStyle = phone ? { left: 12, right: 12, bottom: 16 } : { left: Math.max(12, vw / 2 - CARD_W / 2), top: Math.max(12, vh / 2 - cardH / 2), width: CARD_W };
  } else if (phone) {
    // Anchored to the bottom, or to the top when the element is down there.
    cardStyle = box.top + box.height / 2 > vh / 2 ? { left: 12, right: 12, top: 16 } : { left: 12, right: 12, bottom: 16 };
  } else if (vw - (box.left + box.width) >= CARD_W + GAP * 2) {
    cardStyle = { width: CARD_W, left: box.left + box.width + GAP + PAD, top: clamp(box.top, 12, vh - cardH - 12) };
  } else if (vh - (box.top + box.height) >= cardH + GAP * 2) {
    cardStyle = { width: CARD_W, top: box.top + box.height + GAP + PAD, left: clamp(box.left, 12, vw - CARD_W - 12) };
  } else if (box.top >= cardH + GAP * 2) {
    cardStyle = { width: CARD_W, top: box.top - cardH - GAP - PAD, left: clamp(box.left, 12, vw - CARD_W - 12) };
  } else {
    // A whole panel: the explanation goes inside it.
    cardStyle = { width: CARD_W, top: clamp(box.top + 16, 12, vh - cardH - 12), left: clamp(box.left + 16, 12, vw - CARD_W - 12) };
  }

  return createPortal(
    <div className="fixed inset-0 z-[70]" style={{ pointerEvents: "none" }}>
      {box ? (
        <div
          aria-hidden="true"
          className="fixed rounded-[10px] transition-all duration-200 ease-out"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            boxShadow: "0 0 0 2px var(--color-lilac-ink), 0 0 0 9999px var(--color-scrim)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-scrim" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-label="Recorrido guiado"
        aria-describedby="tour-body"
        className="fixed animate-rise rounded-lg border border-line bg-surface p-4 shadow-pop"
        style={{ ...cardStyle, pointerEvents: "auto" }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11.5px] text-text-3">{total > 1 ? `${tour.index + 1} de ${total}` : "Acá está"}</span>
          <button type="button" onClick={endTour} className="-my-2 -mr-2 inline-flex min-h-9 items-center rounded-md px-2 text-[12.5px] font-medium text-text-2 hover:bg-sunken hover:text-ink max-sm:min-h-11">
            {total > 1 && !last ? "Saltar" : "Cerrar"}
          </button>
        </div>
        <p className="mt-1.5 text-[15px] font-semibold tracking-[-0.02em] text-ink">{step.title}</p>
        <p id="tour-body" className="mt-1 text-[13.5px] leading-5 text-text-2">
          {step.body}
          {missing ? " No lo veo en esta pantalla: puede estar en otra sección o en el menú «Más»." : ""}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1" aria-hidden="true">
            {total > 1
              ? tour.steps.map((_, i) => (
                  <span key={i} className={cn("h-1.5 rounded-full transition-all", i === tour.index ? "w-4 bg-lilac-ink" : "w-1.5 bg-line-strong")} />
                ))
              : null}
          </div>
          <div className="flex gap-1.5">
            {tour.index > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => go(-1)}>
                Anterior
              </Button>
            ) : null}
            <Button ref={nextRef} size="sm" onClick={() => go(1)}>
              {last ? "Listo" : "Siguiente"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
