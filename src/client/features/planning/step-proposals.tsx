import { useState } from "react";
import { BookOpen, Check, PencilLine, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { Field, Input, Textarea } from "@client/components/ui/field";
import { Badge, Notice } from "@client/components/ui/misc";
import { Spinner } from "@client/components/ui/spinner";
import { cn } from "@client/lib/cn";
import { ApiError, errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { useAiStatus } from "@client/lib/session";
import { HELP_LEVELS, TUTOR_TYPES } from "@shared/domain/pedagogy";
import { LIMITS, emptyProposal, type ClassProposal } from "@shared/domain/planning";
import { MAX_REFLECTION_QUESTIONS } from "@shared/domain/activity-design";
import { useGenerateProposals } from "./api";
import { draftEdited, inputSignature, proposalsInput, type WizardState } from "./wizard-state";

const nf = new Intl.NumberFormat("es-AR");

export function StepProposals({
  state: s,
  update,
  errors,
  onGoToMaterial,
}: {
  state: WizardState;
  update: (p: Partial<WizardState> | ((s: WizardState) => Partial<WizardState>)) => void;
  errors: Record<string, string>;
  onGoToMaterial: () => void;
}) {
  const ai = useAiStatus(true);
  const gen = useGenerateProposals();
  const [confirm, setConfirm] = useState<null | { kind: "regenerate" } | { kind: "choose"; index: number } | { kind: "manual" }>(null);
  const aiOff = ai.data?.ai === "not_configured";
  const stale = s.proposals.length > 0 && s.generatedFor !== null && s.generatedFor !== inputSignature(s);
  const edited = draftEdited(s);

  const generate = () => {
    gen.mutate(proposalsInput(s), {
      onSuccess: (r) =>
        update((cur) => ({
          proposals: r.proposals,
          usage: r.material,
          generatedFor: inputSignature(cur),
          ...(cur.chosen === -1 ? {} : { chosen: null, draft: null, draftBase: null }),
        })),
    });
  };
  const choose = (index: number) => {
    const p = s.proposals[index];
    if (!p) return;
    update({ chosen: index, draft: structuredClone(p), draftBase: JSON.stringify(p), tutorId: null });
  };
  const writeMyself = () => {
    gen.reset();
    const p = emptyProposal();
    update({ chosen: -1, draft: p, draftBase: JSON.stringify(p), tutorId: null });
  };

  const err = gen.error instanceof ApiError ? gen.error : null;
  const aiDown = Boolean(err && (err.status === 503 || err.status === 429 || err.code.startsWith("ai_")));
  const materialIssue = Boolean(err && (err.code === "material_failed" || err.code === "material_pending"));

  return (
    <div className="grid gap-6">
      {aiOff ? (
        <Notice
          tone="amber"
          title="La IA no está disponible en este servidor"
          action={s.chosen !== -1 ? <Button onClick={writeMyself} icon={<PencilLine className="size-4" />}>Escribirla yo</Button> : undefined}
        >
          Podés escribir la actividad vos y seguir con el tutor y la revisión: todo lo demás funciona igual.
        </Notice>
      ) : null}

      {!aiOff ? (
        <section className="rounded-lg border border-line bg-surface p-5 shadow-1" aria-labelledby="gen-title">
          <h3 id="gen-title" className="font-display text-lg font-semibold text-ink">
            {s.proposals.length ? "¿Querés otras propuestas?" : "Propuestas de la IA"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-text-2">
            La IA lee {s.materialIds.length || s.extraText.trim() ? "el material que elegiste (si es muy largo, las partes más relacionadas con el tema)" : "los datos de la clase"} y propone 3 actividades distintas para «{s.topic.trim() || "tu clase"}». Son sugerencias: elegís una y la editás antes de crear.
          </p>
          <Field label="Pedido para la IA" optional className="mt-4" hint="Ej.: «que trabajen en parejas», «más corta», «con un caso de la vida cotidiana».">
            {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={s.request} onChange={(e) => update({ request: e.target.value })} maxLength={600} />}
          </Field>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              icon={s.proposals.length ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
              loading={gen.isPending}
              onClick={() => (edited && s.chosen !== -1 ? setConfirm({ kind: "regenerate" }) : generate())}
            >
              {s.proposals.length ? "Generar otras" : "Generar 3 propuestas"}
            </Button>
            {s.chosen !== -1 ? (
              <Button variant="ghost" icon={<PencilLine className="size-4" />} onClick={() => (edited ? setConfirm({ kind: "manual" }) : writeMyself())} disabled={gen.isPending}>
                Prefiero escribirla yo
              </Button>
            ) : null}
          </div>
          <div aria-live="polite" className="mt-3 text-sm">
            {gen.isPending ? (
              <p className="flex items-center gap-2 text-text-2">
                <Spinner className="size-4 text-ink" />
                La IA está leyendo el material y armando las propuestas. Puede tardar hasta un minuto.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {gen.isError && !gen.isPending ? (
        aiDown ? (
          <Notice
            tone="amber"
            title="No pudimos generar las propuestas"
            action={
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={generate} icon={<RefreshCw className="size-4" />}>
                  Reintentar
                </Button>
                <Button onClick={writeMyself} icon={<PencilLine className="size-4" />}>
                  Escribirla yo
                </Button>
              </div>
            }
          >
            {errorMessage(gen.error)} Mientras tanto, podés escribir la actividad vos y seguir.
          </Notice>
        ) : (
          <Notice
            tone="rose"
            title="No pudimos generar las propuestas"
            action={
              materialIssue ? (
                <Button variant="secondary" onClick={onGoToMaterial}>
                  Ir al paso Material
                </Button>
              ) : (
                <Button variant="secondary" onClick={generate} icon={<RefreshCw className="size-4" />}>
                  Reintentar
                </Button>
              )
            }
          >
            {errorMessage(gen.error)}
          </Notice>
        )
      ) : null}

      {s.proposals.length ? (
        <section aria-labelledby="props-title" className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="props-title" className="font-display text-lg font-semibold text-ink">
              Elegí una propuesta
            </h3>
            <Badge tone="lilac">Sugerencia de la IA</Badge>
          </div>
          {stale ? (
            <Notice tone="amber">Cambiaste datos de la clase, el material o el enfoque después de generar estas propuestas. Generá otras para que los tengan en cuenta.</Notice>
          ) : null}
          {s.usage && s.usage.mode === "excerpts" ? (
            <Notice tone="ink">
              El material es largo ({nf.format(s.usage.totalChars)} caracteres): la IA leyó los fragmentos más relacionados con el tema ({nf.format(s.usage.sentChars)} caracteres). Durante la actividad, el tutor busca en el material completo.
            </Notice>
          ) : s.usage && s.usage.mode === "full" ? (
            <p className="text-[13px] text-text-3">
              La IA leyó el material completo: {plural(s.usage.materials.length, "material", "materiales")}
              {s.extraText.trim() ? " y tu texto" : ""}, {nf.format(s.usage.totalChars)} caracteres.
            </p>
          ) : null}
          <ul className="grid gap-3 lg:grid-cols-3">
            {s.proposals.map((p, i) => (
              <li key={i}>
                <ProposalCard
                  p={p}
                  selected={s.chosen === i}
                  onChoose={() => (s.chosen === i ? undefined : edited ? setConfirm({ kind: "choose", index: i }) : choose(i))}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {s.draft ? (
        <ProposalEditor
          draft={s.draft}
          manual={s.chosen === -1}
          errors={errors}
          onChange={(d) => update({ draft: d })}
          onBackToAi={s.proposals.length && s.chosen === -1 ? () => update({ chosen: null, draft: null, draftBase: null }) : undefined}
        />
      ) : errors.draft ? (
        <p role="alert" className="text-sm font-medium text-rose">
          {errors.draft}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Descartar tus cambios en la propuesta?"
        description={<p>Editaste la propuesta elegida. Si seguís, esos cambios se pierden.</p>}
        confirmLabel={confirm?.kind === "regenerate" ? "Descartar y generar otras" : "Descartar cambios"}
        cancelLabel="Volver"
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c?.kind === "regenerate") generate();
          else if (c?.kind === "choose") choose(c.index);
          else if (c?.kind === "manual") writeMyself();
        }}
      />
    </div>
  );
}

function ProposalCard({ p, selected, onChoose }: { p: ClassProposal; selected: boolean; onChoose: () => void }) {
  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-lg border bg-surface p-4 shadow-1 transition-[border-color,box-shadow]",
        selected ? "border-ink ring-2 ring-ink/15" : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="ink">{p.activityType}</Badge>
        <Badge tone="neutral">{TUTOR_TYPES[p.tutorType] ?? "Tutor"}</Badge>
      </div>
      <h4 className="mt-2.5 font-display text-lg leading-snug font-semibold text-ink">{p.title}</h4>
      <p className="mt-2 text-sm leading-6 whitespace-pre-line text-text">{p.instructions}</p>
      {p.objectives ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-text-3">Objetivos</p>
          <p className="text-sm leading-6 whitespace-pre-line text-text-2">{p.objectives}</p>
        </div>
      ) : null}
      {p.materialRefs.length ? (
        <div className="mt-3 rounded-md bg-lilac-soft/60 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-lilac-ink">
            <BookOpen className="size-3.5" aria-hidden="true" />
            Se apoya en
          </p>
          <ul className="mt-0.5 text-[13px] leading-5 text-text-2">
            {p.materialRefs.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-lilac-ink select-none">Más detalles</summary>
        <dl className="mt-2 grid gap-2 text-[13px] leading-5 text-text-2">
          {p.teacherNotes ? (
            <div>
              <dt className="font-semibold text-text">Para vos</dt>
              <dd>{p.teacherNotes}</dd>
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-text">Tutor sugerido</dt>
            <dd>
              {TUTOR_TYPES[p.tutorType]} · {HELP_LEVELS[p.helpLevel]?.label}
            </dd>
          </div>
          {p.tutorGuidance ? (
            <div>
              <dt className="font-semibold text-text">Indicaciones para el tutor</dt>
              <dd className="whitespace-pre-line">{p.tutorGuidance}</dd>
            </div>
          ) : null}
          {p.reflectionQuestions.length ? (
            <div>
              <dt className="font-semibold text-text">Reflexión final</dt>
              <dd>
                <ul className="list-disc pl-4">
                  {p.reflectionQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      </details>
      <div className="mt-auto pt-4">
        <Button className="w-full" variant={selected ? "primary" : "secondary"} aria-pressed={selected} icon={selected ? <Check className="size-4" /> : undefined} onClick={onChoose}>
          {selected ? "Elegida" : "Elegir esta"}
        </Button>
      </div>
    </article>
  );
}

function ProposalEditor({
  draft: d,
  manual,
  errors,
  onChange,
  onBackToAi,
}: {
  draft: ClassProposal;
  manual: boolean;
  errors: Record<string, string>;
  onChange: (d: ClassProposal) => void;
  onBackToAi?: () => void;
}) {
  const set = <K extends keyof ClassProposal>(k: K, v: ClassProposal[K]) => onChange({ ...d, [k]: v });
  const setQuestion = (i: number, v: string) => set("reflectionQuestions", d.reflectionQuestions.map((q, j) => (j === i ? v : q)));
  return (
    <section aria-labelledby="draft-title" className="rounded-lg border border-line bg-surface p-5 shadow-1">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="draft-title" className="font-display text-lg font-semibold text-ink">
            {manual ? "Escribí la actividad" : "Revisá y editá la propuesta elegida"}
          </h3>
          <p className="mt-0.5 text-sm text-text-2">{manual ? "Lo que escribas acá es lo que ven tus alumnos." : "Cambiá lo que quieras: esto es lo que se va a guardar."}</p>
        </div>
        {onBackToAi ? (
          <Button size="sm" variant="ghost" onClick={onBackToAi}>
            Volver a las propuestas
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4">
        <Field label="Título" error={errors.title} counter={{ value: d.title.length, max: LIMITS.title }}>
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={LIMITS.title} />}
        </Field>
        <Field label="Consigna" error={errors.instructions} hint="La leen tus alumnos al empezar. Conviene que termine con una pregunta abierta." counter={{ value: d.instructions.length, max: LIMITS.instructions }}>
          {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={d.instructions} onChange={(e) => set("instructions", e.target.value)} minRows={4} />}
        </Field>
        <Field label="Objetivos" optional error={errors.objectives} counter={{ value: d.objectives.length, max: LIMITS.objectives }}>
          {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} value={d.objectives} onChange={(e) => set("objectives", e.target.value)} minRows={2} />}
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-text">
            Preguntas de reflexión final <span className="font-normal text-text-3">(opcional)</span>
          </legend>
          <p className="-mt-1 text-[13px] text-text-3">El alumno las responde al terminar. Si las quitás todas, la actividad no tiene reflexión.</p>
          {d.reflectionQuestions.map((q, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Pregunta de reflexión ${i + 1}`} value={q} onChange={(e) => setQuestion(i, e.target.value)} maxLength={LIMITS.reflection} />
              <Button variant="ghost" size="icon" aria-label={`Quitar la pregunta ${i + 1}`} onClick={() => set("reflectionQuestions", d.reflectionQuestions.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {d.reflectionQuestions.length < MAX_REFLECTION_QUESTIONS ? (
            <Button variant="secondary" size="sm" className="justify-self-start" icon={<Plus className="size-4" />} onClick={() => set("reflectionQuestions", [...d.reflectionQuestions, ""])}>
              Agregar pregunta
            </Button>
          ) : null}
        </fieldset>
        <Field label="Indicaciones para el tutor" optional hint="Qué preguntar, qué errores esperar, cuándo cerrar. Los alumnos no las ven." counter={{ value: d.tutorGuidance.length, max: LIMITS.tutorGuidance }}>
          {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} value={d.tutorGuidance} onChange={(e) => set("tutorGuidance", e.target.value)} minRows={2} />}
        </Field>
        <Field label="Notas para vos" optional hint="Los alumnos no las ven. Se guardan como contexto en las indicaciones del tutor." counter={{ value: d.teacherNotes.length, max: LIMITS.teacherNotes }}>
          {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} value={d.teacherNotes} onChange={(e) => set("teacherNotes", e.target.value)} minRows={2} />}
        </Field>
      </div>
    </section>
  );
}

export function proposalErrors(s: WizardState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!s.draft) {
    e.draft = "Elegí una de las propuestas o escribí la actividad vos.";
    return e;
  }
  if (!s.draft.title.trim()) e.title = "Poné un título.";
  if (!s.draft.instructions.trim()) e.instructions = "Escribí la consigna.";
  return e;
}
