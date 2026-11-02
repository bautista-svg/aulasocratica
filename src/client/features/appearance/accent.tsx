// The app's color: a picker for whoever has the permission, shown once when they come in (until a
// color is chosen) and in "Mi cuenta". The choice applies to everyone, students included.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { api, errorMessage } from "@client/lib/api";
import { applyAccent } from "@client/lib/theme";
import { cn } from "@client/lib/cn";
import { ACCENTS, ACCENT_INFO, type Accent } from "@shared/domain/accents";
import type { AppearanceResponse } from "@shared/contracts/settings";

export const appearanceKey = ["appearance"] as const;

export function useAppearance() {
  return useQuery({
    queryKey: appearanceKey,
    queryFn: ({ signal }) => api.get<AppearanceResponse>("/api/settings/appearance", signal),
    staleTime: 60_000,
  });
}

function useSaveAccent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accent: Accent) => api.put<AppearanceResponse>("/api/settings/appearance", { accent }),
    onSuccess: (r) => {
      qc.setQueryData(appearanceKey, r);
      applyAccent(r.accent);
    },
  });
}

/** Seven swatches; picking one previews it on the whole screen right away. */
export function AccentPicker({ value, onChange }: { value: Accent; onChange: (a: Accent) => void }) {
  return (
    <div role="radiogroup" aria-label="Color de la app" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ACCENTS.map((a) => {
        const on = a === value;
        return (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(a)}
            className={cn(
              "flex min-h-12 items-center gap-2.5 rounded-md border px-3 text-left text-[14px] font-medium transition-colors",
              on ? "border-text bg-sunken text-ink" : "border-line bg-surface text-text-2 hover:border-line-strong hover:text-ink",
            )}
          >
            <span
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: ACCENT_INFO[a].swatch, boxShadow: on ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${ACCENT_INFO[a].swatch}` : undefined }}
              aria-hidden="true"
            >
              {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
            {ACCENT_INFO[a].name}
          </button>
        );
      })}
    </div>
  );
}

/** "Mi cuenta": change the color any time (only with the permission). */
export function AccentSettings() {
  const q = useAppearance();
  const save = useSaveAccent();
  if (!q.data?.canChoose) return null;
  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-1" aria-labelledby="color-app">
      <h2 id="color-app" className="text-[16px] font-semibold tracking-[-0.02em] text-ink">
        Color de la app
      </h2>
      <p className="mt-1 mb-4 text-[14px] text-text-2">Lo ven todos: docentes y alumnos. Se guarda apenas lo elegís.</p>
      <AccentPicker
        value={q.data.accent}
        onChange={(a) =>
          save.mutate(a, {
            onSuccess: () => toast.success(`Color guardado: ${ACCENT_INFO[a].name}`),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </section>
  );
}

/**
 * The first time someone with the permission comes in (no color chosen yet): pick the color. It
 * waits for other dialogs (Novedades) to close, and previews each color on the real screen.
 */
export function AccentChooser() {
  const q = useAppearance();
  const save = useSaveAccent();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Accent | null>(null);
  const asked = useRef(false);
  const needed = Boolean(q.data?.canChoose && !q.data.chosen);

  useEffect(() => {
    if (!needed || asked.current) return;
    let calm = 0;
    const t = setInterval(() => {
      calm = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') ? 0 : calm + 1;
      if (calm >= 2) {
        clearInterval(t);
        asked.current = true;
        setOpen(true);
      }
    }, 400);
    return () => clearInterval(t);
  }, [needed]);

  const current = pick ?? q.data?.accent ?? "azul";
  const close = (o: boolean) => {
    setOpen(o);
    // Closed without saving: back to the color everyone sees.
    if (!o && q.data) applyAccent(q.data.accent);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Elegí el color de Aula Socrática"
      description="Es el color de acento de toda la app: el menú, los botones elegidos y las preguntas del tutor. Lo ven todos los docentes y alumnos, y lo podés cambiar cuando quieras en Mi cuenta."
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            Después
          </Button>
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate(current, {
                onSuccess: () => {
                  setOpen(false);
                  toast.success(`Color guardado: ${ACCENT_INFO[current].name}`);
                },
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            Usar {ACCENT_INFO[current].name}
          </Button>
        </>
      }
    >
      <AccentPicker
        value={current}
        onChange={(a) => {
          setPick(a);
          applyAccent(a);
        }}
      />
      <div className="mt-4 flex items-center gap-3 rounded-md border border-line bg-paper px-3 py-3">
        <span className="inline-flex h-8 items-center rounded-md bg-lilac-soft px-3 text-[13.5px] font-medium text-lilac-ink">Así se ve lo elegido</span>
        <span className="q-hang text-[14px]">¿Qué fuente te hace pensar eso?</span>
      </div>
    </Dialog>
  );
}
