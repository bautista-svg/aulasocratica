// "Elegir habilidades": which skills the AI evaluates in this workspace, which of their
// indicators count (one shown with the student's own words is "logrado", or as many as the teacher
// asks for each level), and the teacher's own skills with the observable indicators the AI must
// look for.
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { ChevronDown, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { Checkbox, Switch } from "@client/components/ui/controls";
import { Field, FormError, Input, Select, Textarea } from "@client/components/ui/field";
import { ErrorState, SkeletonList } from "@client/components/ui/misc";
import { errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import {
  CRITERION_MAX,
  DIMENSIONS,
  DIMENSION_KEYS,
  MAX_CRITERIA,
  MAX_CUSTOM_SKILLS,
  MIN_INDICATORS_FOR_LEVELS,
  SKILL_LABEL_MAX,
  SKILL_LEVELS,
  STATUS_LABELS,
  clampThresholds,
  setThreshold,
  skillCatalog,
  suggestedThresholds,
  thresholdBands,
  toneOf,
  type CustomSkill,
  type SkillDef,
  type SkillDimension,
  type SkillLevel,
  type SkillSettings,
  type SkillThresholds,
} from "@shared/domain/skills";
import { useSaveSkillSettings, useSkillSettings } from "./api";
import { LevelMeter, SkillGlyph, TONE_STYLE } from "./ui";

/** The skill's numbers per level, fitted again after its ticked indicators change. */
function refit(d: SkillSettings, key: string): SkillSettings {
  const def = skillCatalog(d).find((s) => s.key === key);
  const ticked = def ? def.criteria.filter((c) => !(d.off[key] ?? []).includes(c)).length : 0;
  const { [key]: current, ...rest } = d.levels;
  const t = clampThresholds(current, ticked);
  return { ...d, levels: t ? { ...rest, [key]: t } : rest };
}

const newId = () => `c_${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;

export function SkillSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const q = useSkillSettings(open);
  const save = useSaveSkillSettings();
  const [draft, setDraft] = useState<SkillSettings | null>(null);
  const [editing, setEditing] = useState<CustomSkill | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A fresh copy each time it opens: closing without saving discards the changes.
  useEffect(() => {
    if (open && q.data) setDraft(structuredClone(q.data.settings));
    if (!open) {
      setDraft(null);
      setEditing(null);
      setError(null);
    }
  }, [open, q.data]);

  const catalog = draft ? skillCatalog(draft) : [];
  const toggle = (key: string, on: boolean) =>
    setDraft((d) => (d ? { ...d, enabled: on ? [...d.enabled, key] : d.enabled.filter((k) => k !== key) } : d));
  const tick = (key: string, criterion: string, on: boolean) =>
    setDraft((d) => {
      if (!d) return d;
      const off = (d.off[key] ?? []).filter((c) => c !== criterion);
      // Fewer ticked indicators: the numbers per level never ask for more than there are.
      return refit({ ...d, off: { ...d.off, [key]: on ? off : [...off, criterion] } }, key);
    });
  const setLevels = (key: string, t: SkillThresholds | null) =>
    setDraft((d) => {
      if (!d) return d;
      const { [key]: _, ...rest } = d.levels;
      return { ...d, levels: t ? { ...rest, [key]: t } : rest };
    });
  const upsert = (skill: CustomSkill) =>
    setDraft((d) => {
      if (!d) return d;
      const exists = d.custom.some((c) => c.id === skill.id);
      return refit(
        {
          custom: exists ? d.custom.map((c) => (c.id === skill.id ? skill : c)) : [...d.custom, skill],
          enabled: exists || d.enabled.includes(skill.id) ? d.enabled : [...d.enabled, skill.id],
          // Indicators rewritten in the form come back ticked.
          off: { ...d.off, [skill.id]: (d.off[skill.id] ?? []).filter((c) => skill.criteria.includes(c)) },
          levels: d.levels,
        },
        skill.id,
      );
    });
  const remove = (id: string) =>
    setDraft((d) => {
      if (!d) return d;
      const { [id]: _, ...levels } = d.levels;
      return { custom: d.custom.filter((c) => c.id !== id), enabled: d.enabled.filter((k) => k !== id), off: { ...d.off, [id]: [] }, levels };
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Elegir habilidades"
      description="Qué habilidades evalúa la IA en los trabajos de tus alumnos y con qué indicadores. Si un alumno muestra uno de los indicadores tildados con sus propias palabras, la habilidad queda en Logrado, salvo que elijas cuántos pide cada nivel."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            loading={save.isPending}
            disabled={!draft || Boolean(editing)}
            onClick={() => {
              if (!draft) return;
              setError(null);
              save.mutate(draft, {
                onSuccess: () => {
                  toast.success("Habilidades guardadas. Los próximos análisis las usan.");
                  onOpenChange(false);
                },
                onError: (e) => setError(errorMessage(e)),
              });
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      {q.isPending || !draft ? (
        q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <SkeletonList rows={3} />
      ) : (
        <div className="grid gap-6">
          {DIMENSION_KEYS.map((dim) => {
            const skills = catalog.filter((s) => s.dimension === dim);
            if (!skills.length) return null;
            return (
              <section key={dim} aria-labelledby={`dim-${dim}`}>
                <h3 id={`dim-${dim}`} className="mb-2 text-xs font-semibold tracking-wide text-lilac-ink uppercase">
                  {DIMENSIONS[dim]}
                </h3>
                <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
                  {skills.map((s) => (
                    <SkillRow
                      key={s.key}
                      skill={s}
                      on={draft.enabled.includes(s.key)}
                      off={draft.off[s.key] ?? []}
                      levels={draft.levels[s.key] ?? null}
                      onToggle={(v) => toggle(s.key, v)}
                      onTick={(c, v) => tick(s.key, c, v)}
                      onLevels={(t) => setLevels(s.key, t)}
                      onEdit={s.custom ? () => setEditing(draft.custom.find((c) => c.id === s.key) ?? null) : undefined}
                      onRemove={s.custom ? () => remove(s.key) : undefined}
                    />
                  ))}
                </ul>
              </section>
            );
          })}

          {editing ? (
            <CustomSkillForm
              initial={editing}
              onCancel={() => setEditing(null)}
              onSave={(s) => {
                upsert(s);
                setEditing(null);
              }}
            />
          ) : draft.custom.length < MAX_CUSTOM_SKILLS ? (
            <button
              type="button"
              onClick={() => setEditing({ id: newId(), label: "", dimension: "cognitiva", criteria: [] })}
              className="flex items-center gap-3 rounded-[14px] border border-dashed border-lilac/60 bg-lilac-soft/40 px-4 py-3.5 text-left transition-colors hover:bg-lilac-soft/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lilac-ink"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface text-lilac-ink shadow-1" aria-hidden="true">
                <Plus className="size-[18px]" />
              </span>
              <span>
                <span className="block font-semibold text-ink">Nueva habilidad</span>
                <span className="block text-sm text-text-2">Una habilidad tuya, con los indicadores que la IA tiene que buscar en la conversación.</span>
              </span>
            </button>
          ) : (
            <p className="text-sm text-text-2">Llegaste al máximo de {MAX_CUSTOM_SKILLS} habilidades propias.</p>
          )}
          <FormError message={error} />
        </div>
      )}
    </Dialog>
  );
}

function SkillRow({
  skill,
  on,
  off,
  levels,
  onToggle,
  onTick,
  onLevels,
  onEdit,
  onRemove,
}: {
  skill: SkillDef;
  on: boolean;
  /** Unticked indicators. */
  off: string[];
  /** How many ticked indicators each level asks for (null: one shown is Logrado). */
  levels: SkillThresholds | null;
  onToggle: (v: boolean) => void;
  onTick: (criterion: string, on: boolean) => void;
  onLevels: (t: SkillThresholds | null) => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const [show, setShow] = useState(false);
  const ticked = skill.criteria.filter((c) => !off.includes(c)).length;
  const listId = useId();
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <SkillGlyph skill={skill.key} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <Switch
            checked={on}
            onCheckedChange={onToggle}
            label={
              <>
                {skill.label}
                {skill.custom ? <span className="ml-2 rounded-full bg-lilac-soft px-2 py-0.5 align-middle text-[11px] font-semibold text-lilac-ink">Tuya</span> : null}
              </>
            }
          />
          <div className="mt-1 flex flex-wrap items-center gap-x-3">
            <button
              type="button"
              aria-expanded={show}
              aria-controls={listId}
              onClick={() => setShow((v) => !v)}
              className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-text-2 hover:text-ink max-sm:min-h-11"
            >
              {show ? "Ocultar indicadores" : "Elegir indicadores"}
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[11px] font-semibold tabular",
                  ticked < skill.criteria.length ? "bg-lilac-soft text-lilac-ink" : "bg-sunken text-text-2",
                )}
              >
                {ticked} de {skill.criteria.length}
              </span>
              <ChevronDown className={cn("size-4 transition-transform", show && "rotate-180")} aria-hidden="true" />
            </button>
            {levels ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-soft px-2 py-0.5 text-[11px] font-semibold text-leaf tabular">
                <LevelMeter status="logrado" className="scale-75" />
                Logrado con {levels.logrado} de {ticked}
              </span>
            ) : null}
            {onEdit ? (
              <button type="button" onClick={onEdit} className="inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-sm font-semibold text-ink hover:underline max-sm:min-h-11">
                <Pencil className="size-3.5" aria-hidden="true" /> Editar
              </button>
            ) : null}
            {onRemove ? (
              <button type="button" onClick={onRemove} className="inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-sm font-semibold text-rose hover:underline max-sm:min-h-11">
                <Trash2 className="size-3.5" aria-hidden="true" /> Quitar
              </button>
            ) : null}
          </div>
          {show ? (
            // On a phone the panel takes the icon's column too: the steppers need the width.
            <fieldset id={listId} className="mt-2 rounded-[12px] bg-paper px-3.5 py-3 max-sm:-ml-12">
              <legend className="sr-only">Indicadores de {skill.label}</legend>
              <p className="mb-2.5 text-xs leading-5 text-text-2">La IA busca solo los tildados. Tiene que quedar al menos uno.</p>
              <ul className="grid gap-2.5">
                {skill.criteria.map((c) => {
                  const checked = !off.includes(c);
                  return (
                    <li key={c}>
                      <Checkbox
                        checked={checked}
                        // The last ticked one stays: a skill needs something to look for.
                        disabled={checked && ticked === 1}
                        onCheckedChange={(v) => onTick(c, v)}
                        label={<span className={cn("text-sm leading-5", !checked && "text-text-2")}>{c}</span>}
                      />
                    </li>
                  );
                })}
              </ul>
              <LevelsEditor skill={skill.label} ticked={ticked} value={levels} onChange={onLevels} />
            </fieldset>
          ) : null}
        </div>
      </div>
    </li>
  );
}

const rangeText = (from: number, to: number) => (from === to ? `${from}` : to === from + 1 ? `${from} o ${to}` : `${from} a ${to}`);

/**
 * "Pedir una cantidad por nivel" (Vanina Gerstner, 28-10): how many of the ticked indicators the
 * student has to show for each level, one stepper per level, and the rule it makes in plain words.
 */
function LevelsEditor({ skill, ticked, value, onChange }: { skill: string; ticked: number; value: SkillThresholds | null; onChange: (t: SkillThresholds | null) => void }) {
  const can = ticked >= MIN_INDICATORS_FOR_LEVELS;
  const bands = value ? thresholdBands(value, ticked) : [];
  return (
    <div className="mt-3.5 border-t border-line pt-3.5">
      <Switch
        checked={Boolean(value)}
        disabled={!can}
        onCheckedChange={(v) => onChange(v ? suggestedThresholds(ticked) : null)}
        label="Elegir cuántos pide cada nivel"
        description={
          !can
            ? "Tildá al menos dos indicadores para pedir una cantidad por nivel."
            : value
              ? "Cuántos de los indicadores tildados tiene que mostrar el alumno, con sus palabras, para llegar a cada nivel."
              : "Ahora, con uno de los tildados queda en Logrado. Activalo para pedir más."
        }
      />
      {value ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SKILL_LEVELS.map((l) => (
              <LevelStepper key={l} skill={skill} level={l} value={value[l]} ticked={ticked} onChange={(v) => onChange(setThreshold(value, l, v, ticked))} />
            ))}
          </div>
          <ul className="mt-3 grid gap-1 text-[13px] leading-5 text-text-2" aria-live="polite" aria-label={`Así se asigna el nivel en ${skill}`}>
            {bands.map((b) => (
              <li key={b.from} className="flex items-start gap-2">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_STYLE[toneOf(b.levels.at(-1) ?? "sin_evidencia")].dot)} aria-hidden="true" />
                <span>
                  {b.from === 0 && b.to === 0 ? "Sin ninguno" : `Con ${rangeText(b.from, b.to)}`}:{" "}
                  <span className="font-semibold text-text">
                    {b.levels.length === 0 ? STATUS_LABELS.sin_evidencia : b.levels.map((l) => STATUS_LABELS[l]).join(" o ")}
                  </span>
                  {b.levels.length > 1 ? ", según lo que vea la IA" : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** One level's number: − and + for touch, arrows on the keyboard (a spinbutton). */
function LevelStepper({ skill, level, value, ticked, onChange }: { skill: string; level: SkillLevel; value: number; ticked: number; onChange: (v: number) => void }) {
  const min = level === "logrado" || level === "avanzado" ? 1 : 0;
  const label = STATUS_LABELS[level];
  const step = (d: number) => onChange(Math.min(ticked, Math.max(min, value + d)));
  const onKey = (e: KeyboardEvent) => {
    const to = { ArrowUp: value + 1, ArrowRight: value + 1, ArrowDown: value - 1, ArrowLeft: value - 1, Home: min, End: ticked }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onChange(Math.min(ticked, Math.max(min, to)));
  };
  const button =
    "relative inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-line disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="rounded-[12px] border border-line bg-surface px-2 pt-2 pb-2.5">
      <p className="flex items-center gap-1.5 px-0.5 text-[13px] font-semibold text-text">
        <LevelMeter status={level} className="scale-[0.8] origin-left" />
        {label}
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <button type="button" tabIndex={-1} className={button} disabled={value <= min} aria-label={`Un indicador menos para ${label}`} onClick={() => step(-1)}>
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <div
          role="spinbutton"
          tabIndex={0}
          aria-label={`${label} en ${skill}: indicadores que pide`}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={ticked}
          aria-valuetext={`${value} de ${ticked} indicadores`}
          onKeyDown={onKey}
          className="min-w-0 flex-1 rounded-md py-0.5 text-center focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lilac-ink"
        >
          <span className="block font-display text-xl leading-6 font-semibold text-ink tabular">{value}</span>
          <span className="block text-[11px] leading-4 text-text-2">de {ticked}</span>
        </div>
        <button type="button" tabIndex={-1} className={button} disabled={value >= ticked} aria-label={`Un indicador más para ${label}`} onClick={() => step(1)}>
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function CustomSkillForm({ initial, onSave, onCancel }: { initial: CustomSkill; onSave: (s: CustomSkill) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(initial.label);
  const [dimension, setDimension] = useState<SkillDimension>(initial.dimension);
  const [criteria, setCriteria] = useState(initial.criteria.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const lines = criteria
    .split("\n")
    .map((l) => l.replace(/^[-•·*\d.)\s]+/, "").trim())
    .filter(Boolean);

  return (
    <form
      className="grid gap-4 rounded-[14px] border border-lilac/50 bg-lilac-soft/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return setError("Escribí el nombre de la habilidad.");
        if (lines.length === 0) return setError("Escribí al menos un indicador.");
        if (lines.length > MAX_CRITERIA) return setError(`Hasta ${MAX_CRITERIA} indicadores.`);
        if (lines.some((l) => l.length > CRITERION_MAX)) return setError(`Cada indicador, hasta ${CRITERION_MAX} caracteres.`);
        onSave({ ...initial, label: label.trim(), dimension, criteria: lines });
      }}
    >
      <p className="font-display text-lg font-semibold text-ink">{initial.label ? "Editar habilidad" : "Nueva habilidad"}</p>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
        <Field label="Nombre" counter={{ value: label.length, max: SKILL_LABEL_MAX }}>
          {(p) => (
            <Input id={p.id} aria-describedby={p.describedBy} value={label} maxLength={SKILL_LABEL_MAX} placeholder="Ej.: Trabajo con fuentes" onChange={(e) => setLabel(e.target.value)} />
          )}
        </Field>
        <Field label="Dimensión">
          {(p) => (
            <Select id={p.id} value={dimension} onChange={(e) => setDimension(e.target.value as SkillDimension)}>
              {DIMENSION_KEYS.map((d) => (
                <option key={d} value={d}>
                  {DIMENSIONS[d]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Indicadores observables" hint={`Uno por línea, hasta ${MAX_CRITERIA}. Qué tiene que hacer el alumno en la conversación para mostrar la habilidad.`}>
        {(p) => (
          <Textarea
            id={p.id}
            aria-describedby={p.describedBy}
            value={criteria}
            minRows={4}
            placeholder={"Distingue fuentes primarias y secundarias.\nCompara lo que dicen dos fuentes.\nIndica de dónde saca cada dato."}
            onChange={(e) => setCriteria(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm">
          {initial.label ? "Listo" : "Agregar habilidad"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <FormError message={error} />
      </div>
    </form>
  );
}
