// "Habilidades" of one work: each skill the workspace evaluates, by dimension, with its level and
// the evidence behind it (a real quote of the student). The teacher can correct a level; the
// group view and the student's page count these.
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Lightbulb, RefreshCw, SlidersHorizontal, Sparkles } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Badge } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { FormError, Select } from "@client/components/ui/field";
import { errorMessage } from "@client/lib/api";
import { fmtDateTime, plural } from "@client/lib/format";
import { DIMENSIONS, DIMENSION_KEYS, SKILL_STATUSES, STATUS_LABELS, toneOf, type SkillAssessment, type SkillDef, type SkillStatus } from "@shared/domain/skills";
import type { SessionDetail } from "@shared/contracts/sessions";
import { EvidenceCard, LevelPill, SkillGlyph, ToneLegend } from "@client/features/skills/ui";
import { SkillSettingsDialog } from "@client/features/skills/settings-dialog";
import { useSessionMutations } from "./api";

export function SkillsCard({ detail }: { detail: SessionDetail }) {
  const m = useSessionMutations(detail.session.id);
  const { skills, catalog, recommendations, interventions, skillsAt } = detail.skills;
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const byKey = new Map(skills.map((s) => [s.skill, s]));
  const good = catalog.filter((s) => toneOf(byKey.get(s.key)?.status) === "good");
  const grow = catalog.filter((s) => toneOf(byKey.get(s.key)?.status) === "grow");

  return (
    <section aria-labelledby="skills-title" className="min-w-0 rounded-lg border border-line bg-surface p-5 shadow-1 sm:p-6 xl:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="skills-title" className="font-display text-lg font-semibold text-ink">
          Habilidades
        </h2>
        <Badge tone="lilac">
          <Sparkles className="size-3" aria-hidden="true" /> Inferencia de la IA
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-text-2">
        Cada habilidad en uno de cuatro niveles, con el indicador observado y una cita real de lo que escribió el alumno. «Sin evidencia» quiere decir
        que la conversación no alcanzó para evaluarla, no que le haya ido mal. Si no coincidís con un nivel, corregilo.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="lilac"
          icon={skillsAt ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
          loading={m.analyzeSkills.isPending}
          onClick={() => {
            setError(null);
            m.analyzeSkills.mutate(undefined, {
              onSuccess: (r) =>
                toast.success(
                  r.droppedQuotes
                    ? `Listo. ${plural(r.droppedQuotes, "habilidad quedó", "habilidades quedaron")} sin evidencia porque la cita no era del alumno.`
                    : "Habilidades evaluadas",
                ),
              onError: (e) => setError(errorMessage(e)),
            });
          }}
        >
          {skillsAt ? "Volver a evaluar" : "Evaluar con IA"}
        </Button>
        <Button size="sm" variant="ghost" icon={<SlidersHorizontal className="size-4" />} onClick={() => setChoosing(true)}>
          Elegir habilidades
        </Button>
        {skillsAt ? (
          <span className="text-xs text-text-3">
            Última evaluación: {fmtDateTime(skillsAt)} · leyó {plural(interventions, "intervención", "intervenciones")} del alumno
          </span>
        ) : null}
      </div>
      {m.analyzeSkills.isPending ? (
        <p role="status" className="mt-2 text-sm text-lilac-ink">
          La IA está leyendo el trabajo completo del alumno…
        </p>
      ) : null}
      <div className="mt-3">
        <FormError message={error} />
      </div>

      {skillsAt ? (
        <div className="mt-4 grid min-w-0 gap-5 [&>*]:min-w-0" aria-live="polite">
          <div className="grid gap-3 md:grid-cols-2">
            <Summary title="Fortalezas" tone="good" skills={good} empty="Todavía ninguna habilidad lograda." />
            <Summary title="Para desarrollar" tone="grow" skills={grow} empty="Nada para desarrollar por ahora." />
          </div>
          <ToneLegend />
          {DIMENSION_KEYS.map((dim) => {
            const defs = catalog.filter((s) => s.dimension === dim);
            if (!defs.length) return null;
            return (
              <div key={dim}>
                <p className="mb-2 text-xs font-semibold tracking-wide text-lilac-ink uppercase">{DIMENSIONS[dim]}</p>
                <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line">
                  {defs.map((def) => (
                    <SkillRow key={def.key} def={def} a={byKey.get(def.key) ?? null} sessionId={detail.session.id} onError={setError} />
                  ))}
                </ul>
              </div>
            );
          })}
          {recommendations.length ? (
            <div className="rounded-[14px] bg-ink-soft/60 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Lightbulb className="size-4" aria-hidden="true" /> Recomendaciones para vos
              </h3>
              <ul className="mt-2 space-y-1.5">
                {recommendations.map((r) => (
                  <li key={r} className="flex gap-2 text-[15px] leading-6 text-text">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : !m.analyzeSkills.isPending ? (
        <p className="mt-4 rounded-md border border-dashed border-line-strong px-4 py-3 text-sm text-text-2">
          Todavía no se evaluaron las habilidades de este trabajo. Pedíselo a la IA: tarda unos segundos.
        </p>
      ) : null}
      <SkillSettingsDialog open={choosing} onOpenChange={setChoosing} />
    </section>
  );
}

function Summary({ title, tone, skills, empty }: { title: string; tone: "good" | "grow"; skills: SkillDef[]; empty: string }) {
  return (
    <div className={cn("rounded-[14px] p-4", tone === "good" ? "bg-leaf-soft/70" : "bg-amber-soft/70")}>
      <h3 className={cn("text-sm font-semibold", tone === "good" ? "text-leaf" : "text-amber")}>{title}</h3>
      {skills.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <li key={s.key} className="rounded-full bg-surface px-2.5 py-1 text-sm font-semibold text-text shadow-1">
              {s.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-text-2">{empty}</p>
      )}
    </div>
  );
}

function SkillRow({ def, a, sessionId, onError }: { def: SkillDef; a: SkillAssessment | null; sessionId: string; onError: (m: string) => void }) {
  const m = useSessionMutations(sessionId);
  const [open, setOpen] = useState(false);
  const saving = m.setSkillLevel.isPending && m.setSkillLevel.variables?.skill === def.key;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        // On a phone the level goes under the name instead of pushing the card wider.
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-paper"
      >
        <SkillGlyph skill={def.key} status={a?.status ?? null} />
        <span className="min-w-32 flex-1 font-semibold text-text">{def.label}</span>
        <LevelPill status={a?.status ?? null} />
        <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div className="grid gap-3 bg-paper/70 px-4 pt-1 pb-4">
          {a ? (
            <EvidenceCard a={a} />
          ) : (
            <p className="text-sm text-text-2">Esta habilidad no se evaluó en este trabajo (se eligió después del análisis o la actividad no la permite).</p>
          )}
          <label className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text">
            Corregir el nivel
            <Select
              className="h-10 w-auto min-w-48"
              value={a?.status ?? ""}
              disabled={saving}
              onChange={(e) =>
                m.setSkillLevel.mutate(
                  { skill: def.key, status: e.target.value as SkillStatus },
                  {
                    onSuccess: () => toast.success(`Nivel de «${def.label}» corregido`),
                    onError: (err) => onError(errorMessage(err)),
                  },
                )
              }
            >
              {a ? null : <option value="">Elegí un nivel…</option>}
              {SKILL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </label>
        </div>
      ) : null}
    </li>
  );
}
