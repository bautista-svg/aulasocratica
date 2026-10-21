import { useId, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, ErrorState, Notice, Skeleton } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { cn } from "@client/lib/cn";
import { useTutor, useTutors } from "@client/features/tutors/api";
import { HelpLevelField, TutorTypeField } from "@client/features/tutors/tutor-fields";
import { TutorTypeTile, helpLabel, typeLabel } from "@client/features/tutors/tutor-visual";
import { tutorRulesPreview } from "@client/features/tutors/tutor-editor";
import { TUTOR_TYPE_GUIDANCE } from "@shared/domain/pedagogy";
import { MAX_TUTOR_RULES } from "@shared/domain/tutors";
import { composeActivityRules, type ClassProposal } from "@shared/domain/planning";
import type { TutorSummary } from "@shared/contracts/tutors";
import type { WizardState } from "./wizard-state";

const DROPPED: Record<string, string> = {
  indicaciones: "las indicaciones de la propuesta",
  tutor: "la configuración del tutor elegido",
  notas: "tus notas",
};

export function StepTutor({ state: s, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const tutors = useTutors();
  const detail = useTutor(s.tutorId);
  const [showAll, setShowAll] = useState(false);
  const name = useId();
  const typeId = useId();
  const draft = s.draft!;
  const setDraft = (p: Partial<ClassProposal>) => update({ draft: { ...draft, ...p } });

  const list = useMemo(() => {
    const all = tutors.data ?? [];
    const mine = all.filter((t) => !t.presetKey);
    const recommended = all.filter((t) => t.presetKey === draft.tutorType);
    const rest = all.filter((t) => t.presetKey && t.presetKey !== draft.tutorType);
    return { short: [...recommended, ...mine], all: [...recommended, ...mine, ...rest] };
  }, [tutors.data, draft.tutorType]);
  const shown = showAll ? list.all : list.short;
  const selectedOutside = s.tutorId && !shown.some((t) => t.id === s.tutorId);

  const chosen = s.tutorId ? detail.data : null;
  const rules = composeActivityRules({
    guidance: draft.tutorGuidance,
    tutorRules: chosen ? tutorRulesPreview(chosen).text : "",
    teacherNotes: draft.teacherNotes,
  });
  const type = chosen?.tutorType ?? draft.tutorType;
  const help = chosen?.helpLevel ?? draft.helpLevel;

  return (
    <div className="grid gap-6">
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-semibold text-text">¿Con qué tutor trabaja esta actividad?</legend>

        <label
          className={cn(
            "flex cursor-pointer gap-3 rounded-lg border px-4 py-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lilac-ink",
            !s.tutorId ? "border-ink bg-ink-soft/50" : "border-line-strong bg-surface hover:border-ink/40",
          )}
        >
          <input type="radio" name={name} checked={!s.tutorId} onChange={() => update({ tutorId: null })} className="mt-1 size-4 accent-[var(--color-ink)]" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 font-semibold text-text">
              {s.chosen === -1 ? "Elegir el tipo de tutor acá" : "La sugerencia de la propuesta"}
              {s.chosen !== -1 ? (
                <Badge tone="lilac">
                  <Sparkles className="size-3" aria-hidden="true" />
                  IA
                </Badge>
              ) : null}
            </span>
            <span className="block text-sm text-text-2">
              {typeLabel(draft.tutorType)} · {helpLabel(draft.helpLevel)}, con las indicaciones de la actividad.
            </span>
          </span>
        </label>
        {!s.tutorId ? (
          <div className="grid gap-4 rounded-lg border border-line bg-paper px-4 py-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-semibold text-text" htmlFor={typeId}>
                Tipo de tutor
              </label>
              <TutorTypeField id={typeId} value={draft.tutorType} onChange={(v) => setDraft({ tutorType: v })} />
            </div>
            <HelpLevelField value={draft.helpLevel} onChange={(v) => setDraft({ helpLevel: v })} />
          </div>
        ) : null}

        <p className="mt-3 text-sm font-semibold text-text">O uno de Mis tutores</p>
        {tutors.isPending ? (
          <Skeleton className="h-28 w-full" />
        ) : tutors.isError ? (
          <ErrorState error={tutors.error} onRetry={() => void tutors.refetch()} />
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {[...(selectedOutside ? list.all.filter((t) => t.id === s.tutorId) : []), ...shown].map((t) => (
                <li key={t.id}>
                  <TutorOption tutor={t} name={name} checked={s.tutorId === t.id} recommended={t.presetKey === draft.tutorType} onPick={() => update({ tutorId: t.id })} />
                </li>
              ))}
            </ul>
            {list.all.length > list.short.length ? (
              <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Mostrar menos" : `Ver todos los tutores (${list.all.length})`}
              </Button>
            ) : null}
          </>
        )}
      </fieldset>

      <section aria-labelledby="rules-preview" className="rounded-lg border border-line bg-paper px-4 py-4">
        <h3 id="rules-preview" className="font-display text-base font-semibold text-ink">
          Lo que va a recibir el tutor
        </h3>
        <p className="mt-0.5 text-[13px] leading-5 text-text-3">
          Se suma debajo de las reglas generales del tutor socrático. La actividad guarda una copia: si después editás el tutor en Mis tutores, esta actividad no cambia.
        </p>
        {s.tutorId && detail.isPending ? (
          <Skeleton className="mt-3 h-20 w-full" />
        ) : s.tutorId && detail.isError ? (
          <div className="mt-3">
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <TutorTypeTile type={type} size="sm" />
              <Badge tone="ink">{typeLabel(type)}</Badge>
              <Badge tone="neutral">{helpLabel(help)}</Badge>
            </div>
            {TUTOR_TYPE_GUIDANCE[type] ? (
              <p className="mt-3 text-sm leading-6 text-text-2">
                <span className="font-semibold text-text">Cómo trabajar: </span>
                {TUTOR_TYPE_GUIDANCE[type]}
              </p>
            ) : null}
            <pre className="mt-3 max-h-72 overflow-y-auto rounded-md bg-surface px-3 py-2.5 font-sans text-sm leading-6 whitespace-pre-wrap text-text">
              {rules.text || "Sin indicaciones extra: el tutor trabaja con su tipo y su nivel de ayuda."}
            </pre>
            <p className="mt-2 text-[13px] text-text-3">
              {rules.text.length} de {MAX_TUTOR_RULES} caracteres.
            </p>
            {rules.dropped.length ? (
              <Notice tone="amber" className="mt-3">
                No entra todo en los {MAX_TUTOR_RULES} caracteres que recibe el tutor: quedan afuera {rules.dropped.map((d) => DROPPED[d]).join(" y ")}. Acortá las indicaciones en el paso Propuestas o elegí otro tutor.
              </Notice>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function TutorOption({ tutor: t, name, checked, recommended, onPick }: { tutor: TutorSummary; name: string; checked: boolean; recommended: boolean; onPick: () => void }) {
  return (
    <label
      className={cn(
        "flex h-full cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lilac-ink",
        checked ? "border-ink bg-ink-soft/50" : "border-line-strong bg-surface hover:border-ink/40",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onPick} className="mt-2.5 size-4 accent-[var(--color-ink)]" />
      <TutorTypeTile type={t.tutorType} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold break-words text-text">{t.name}</span>
        <span className="block text-[13px] text-text-2">
          {t.presetKey && t.name === typeLabel(t.tutorType) ? helpLabel(t.helpLevel) : `${typeLabel(t.tutorType)} · ${helpLabel(t.helpLevel)}`}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {recommended ? <Badge tone="lilac">Del tipo sugerido</Badge> : null}
          {t.customized ? <Badge tone="neutral">Editado</Badge> : null}
          {!t.presetKey ? <Badge tone="ink">Propio</Badge> : null}
        </span>
      </span>
    </label>
  );
}
