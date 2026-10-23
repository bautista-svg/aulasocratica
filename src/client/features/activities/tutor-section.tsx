// Tutor configuration of an activity: start from a saved tutor ("Mis tutores") or set the
// type (up to three combined), help level and teacher indications by hand.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bot, Check, ChevronRight } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Field, Select, Textarea } from "@client/components/ui/field";
import { cn } from "@client/lib/cn";
import { errorMessage } from "@client/lib/api";
import { useTutors } from "@client/features/tutors/api";
import { tutorOptionLabel } from "@client/features/tutors/tutor-visual";
import { HELP_LEVELS, MAX_TUTOR_TYPES, TUTOR_FOCUS_TYPES, TUTOR_FORMAT_TYPES, TUTOR_TYPE_INFO, TUTOR_TYPES } from "@shared/domain/pedagogy";
import { ACTIVITY_LIMITS, type ActivityEditorData, type HelpLevel } from "@shared/contracts/activities";
import { MAX_TUTOR_RULES_WORDS, countWords } from "@shared/domain/tutors";
import { useApplyTutor } from "./api";
import { RadioCards } from "./parts";
import type { ActivityForm } from "./use-activity-form";

export const tutorTypeDescription = (type: string) => TUTOR_TYPE_INFO[type]?.description ?? "";

export function TutorSection({ activity, form }: { activity: ActivityEditorData; form: ActivityForm }) {
  const { draft, set, errors } = form;
  const tutors = useTutors();
  const apply = useApplyTutor(activity.id);
  const [selected, setSelected] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(false);
  const chosen = tutors.data?.find((t) => t.id === selected);
  const types = [draft.tutorType, ...draft.extraTutorTypes];

  return (
    <div className="grid gap-6">
      <div className="rounded-md bg-paper px-4 py-3.5">
        <label htmlFor="saved-tutor" className="text-sm font-semibold text-text">
          Usar un tutor de «Mis tutores»
        </label>
        <p className="mt-0.5 text-[13px] leading-5 text-text-3">
          Copia su tipo, nivel de ayuda e indicaciones a esta actividad. Después podés ajustarlos acá sin cambiar el tutor guardado.
        </p>
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <Select id="saved-tutor" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={tutors.isPending || tutors.isError}>
              <option value="">{tutors.isPending ? "Cargando tutores…" : "Elegí un tutor"}</option>
              {(tutors.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {tutorOptionLabel(t)}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="secondary" disabled={!chosen} loading={apply.isPending} onClick={() => setConfirming(true)}>
            Aplicar tutor
          </Button>
        </div>
        {tutors.isError ? (
          <p role="alert" className="mt-2 text-[13px] text-rose">
            No se pudieron cargar tus tutores.{" "}
            <button type="button" className="font-semibold underline" onClick={() => void tutors.refetch()}>
              Reintentar
            </button>
          </p>
        ) : null}
        <p className="mt-2 text-[13px] text-text-3">
          {activity.tutorName ? (
            <>
              Basada en <span className="font-semibold text-text-2">«{activity.tutorName}»</span>.{" "}
            </>
          ) : null}
          <Link to="/app/tutores" className="-my-3 inline-block py-3 font-semibold text-lilac-ink underline decoration-lilac underline-offset-4">
            Ver Mis tutores
          </Link>
        </p>
      </div>

      <div>
        <p id="tutor-type-label" className="mb-1.5 text-sm font-semibold text-text">
          Tipo de tutor
          <span className="ml-1.5 font-normal text-text-3">(podés combinar hasta {MAX_TUTOR_TYPES})</span>
        </p>
        <div className={cn("rounded-md border bg-surface shadow-1", errors.tutorType || errors.extraTutorTypes ? "border-rose" : "border-line-strong")}>
          <button
            type="button"
            aria-describedby="tutor-type-desc"
            aria-haspopup="dialog"
            onClick={() => setPicking(true)}
            className="flex w-full items-center gap-3 rounded-md px-3.5 pt-3 pb-1.5 text-left transition-colors hover:bg-paper"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-lilac-soft text-lilac-ink">
              <Bot className="size-[18px]" aria-hidden="true" />
            </span>
            <span id="tutor-type-value" className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[15px] font-semibold text-text">
              {types.map((t, i) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  {i > 0 ? <span className="font-normal text-lilac-ink" aria-label="más">+</span> : null}
                  {TUTOR_TYPES[t] ?? "Elegí un tipo"}
                </span>
              ))}
            </span>
            <span id="tutor-type-change" className="flex shrink-0 items-center gap-1 text-sm font-semibold text-lilac-ink">
              <span>
                Cambiar<span className="sr-only"> el tipo de tutor</span>
              </span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </span>
          </button>
          <div id="tutor-type-desc" className="px-3.5 pb-3 pl-[62px] text-[13px] leading-5 text-text-2">
            {types.length > 1 ? (
              <>
                <p className="font-medium text-lilac-ink">Un solo tutor que combina estos enfoques según lo que necesite cada alumno.</p>
                <ul className="mt-1.5 space-y-1">
                  {types.map((t) => (
                    <li key={t}>
                      <span className="font-semibold text-text">{TUTOR_TYPES[t]}:</span> {tutorTypeDescription(t)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              tutorTypeDescription(draft.tutorType)
            )}
          </div>
        </div>
        {errors.tutorType ? <p className="mt-1.5 text-[13px] font-medium text-rose">{errors.tutorType}</p> : null}
        {errors.extraTutorTypes ? <p className="mt-1.5 text-[13px] font-medium text-rose">{errors.extraTutorTypes}</p> : null}
      </div>

      <div>
        <RadioCards<HelpLevel>
          name="help-level"
          legend="Nivel de ayuda"
          value={draft.helpLevel}
          onChange={(v) => set("helpLevel", v)}
          options={(Object.keys(HELP_LEVELS) as HelpLevel[]).map((k) => ({ value: k, label: HELP_LEVELS[k]!.label, description: HELP_LEVELS[k]!.description }))}
        />
        {errors.helpLevel ? <p className="mt-1.5 text-[13px] font-medium text-rose">{errors.helpLevel}</p> : null}
      </div>

      <Field
        label="Indicaciones para el tutor"
        optional
        error={errors.tutorRules}
        counter={{ value: countWords(draft.tutorRules), max: MAX_TUTOR_RULES_WORDS }}
        hint={`Hasta ${MAX_TUTOR_RULES_WORDS.toLocaleString("es-AR")} palabras. Se agregan debajo de las reglas fijas del tutor, que tienen prioridad: guiar con preguntas y no dar la respuesta.`}
      >
        {(p) => (
          <Textarea
            id={p.id}
            aria-describedby={p.describedBy}
            invalid={p.invalid}
            value={draft.tutorRules}
            onChange={(e) => set("tutorRules", e.target.value)}
            minRows={8}
            maxRows={26}
            placeholder="Ej.: Pedí siempre que prueben la regla con otro número antes de cerrar."
          />
        )}
      </Field>

      <TutorTypeDialog
        open={picking}
        onOpenChange={setPicking}
        value={types}
        onPick={(picked) => {
          set("tutorType", picked[0]!);
          set("extraTutorTypes", picked.slice(1));
          setPicking(false);
        }}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        variant="primary"
        title={`¿Aplicar «${chosen?.name ?? ""}»?`}
        description={
          <p>
            Se reemplazan el tipo de tutor, el nivel de ayuda y las indicaciones de esta actividad por las del tutor guardado, y se guardan enseguida. La consigna,
            el material y el resto no cambian.
          </p>
        }
        confirmLabel="Aplicar tutor"
        loading={apply.isPending}
        onConfirm={() =>
          chosen &&
          apply.mutate(chosen.id, {
            onSuccess: (r) => {
              form.adopt(r.activity, ["tutorType", "extraTutorTypes", "helpLevel", "tutorRules"]);
              setConfirming(false);
              setSelected("");
              toast.success(`Tutor aplicado: ${chosen.name}`);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function TutorTypeDialog({
  open,
  onOpenChange,
  value,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: string[];
  onPick: (types: string[]) => void;
}) {
  // Order matters: the first one is the main type (used in lists and when instructions clash).
  const [picked, setPicked] = useState<string[]>(value);
  const [opened, setOpened] = useState(false);
  if (open && !opened) {
    setOpened(true);
    setPicked(value);
  } else if (!open && opened) {
    setOpened(false);
  }
  const full = picked.length >= MAX_TUTOR_TYPES;
  const toggle = (k: string) =>
    setPicked((x) => (x.includes(k) ? (x.length > 1 ? x.filter((t) => t !== k) : x) : x.length < MAX_TUTOR_TYPES ? [...x, k] : x));

  const group = (title: string, types: Record<string, string>) => (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-text-3 uppercase">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.keys(types).map((k) => {
          const order = picked.indexOf(k);
          const selected = order >= 0;
          const locked = !selected && full;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={selected}
              aria-disabled={locked || undefined}
              onClick={() => toggle(k)}
              className={cn(
                "flex flex-col rounded-md border px-3.5 py-3 text-left transition-colors",
                selected ? "border-ink bg-ink-soft/60" : "border-line-strong bg-surface hover:border-ink/40",
                locked && "opacity-55 hover:border-line-strong",
              )}
            >
              <span className="flex items-center justify-between gap-2 text-[15px] font-semibold text-text">
                {TUTOR_TYPES[k]}
                {selected ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink">
                    {picked.length > 1 && order === 0 ? <span className="text-text-2">Principal</span> : null}
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-ink text-white tabular" aria-label={`elegido en el lugar ${order + 1}`}>
                      {picked.length > 1 ? order + 1 : <Check className="size-3.5" aria-hidden="true" />}
                    </span>
                  </span>
                ) : null}
              </span>
              <span className="mt-1 text-[13px] leading-5 text-text-2">{tutorTypeDescription(k)}</span>
              {TUTOR_TYPE_INFO[k]?.whenToUse ? <span className="mt-1.5 text-[12px] leading-5 text-text-3">{TUTOR_TYPE_INFO[k]!.whenToUse}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Elegí el tipo de tutor"
      description={`Podés combinar hasta ${MAX_TUTOR_TYPES}: el alumno conversa con un solo tutor que mezcla esos enfoques. En todos guía con preguntas en lugar de dar la respuesta.`}
      footer={
        <>
          <p className="mr-auto self-center text-sm text-text-2" aria-live="polite">
            {picked.length > 1 ? `Combinás ${picked.length} de ${MAX_TUTOR_TYPES}. El primero es el principal.` : "Tocá otro tipo para combinarlo."}
            {full ? " Para cambiar uno, sacalo primero." : ""}
          </p>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => onPick(picked)}>Listo</Button>
        </>
      }
    >
      {group("Formato de la actividad", TUTOR_FORMAT_TYPES)}
      {group("Enfoque del pensamiento", TUTOR_FOCUS_TYPES)}
    </Dialog>
  );
}
