// "Elegir habilidades": which skills the AI evaluates in this workspace, and the teacher's own
// skills with the observable indicators the AI must look for.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { Switch } from "@client/components/ui/controls";
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
  SKILL_LABEL_MAX,
  skillCatalog,
  type CustomSkill,
  type SkillDef,
  type SkillDimension,
  type SkillSettings,
} from "@shared/domain/skills";
import { useSaveSkillSettings, useSkillSettings } from "./api";
import { SkillGlyph } from "./ui";

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
  const upsert = (skill: CustomSkill) =>
    setDraft((d) => {
      if (!d) return d;
      const exists = d.custom.some((c) => c.id === skill.id);
      return {
        custom: exists ? d.custom.map((c) => (c.id === skill.id ? skill : c)) : [...d.custom, skill],
        enabled: exists || d.enabled.includes(skill.id) ? d.enabled : [...d.enabled, skill.id],
      };
    });
  const remove = (id: string) => setDraft((d) => (d ? { custom: d.custom.filter((c) => c.id !== id), enabled: d.enabled.filter((k) => k !== id) } : d));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Elegir habilidades"
      description="Qué habilidades evalúa la IA en los trabajos de tus alumnos. Podés sumar las tuyas, con sus indicadores."
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
                      onToggle={(v) => toggle(s.key, v)}
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

function SkillRow({ skill, on, onToggle, onEdit, onRemove }: { skill: SkillDef; on: boolean; onToggle: (v: boolean) => void; onEdit?: () => void; onRemove?: () => void }) {
  const [show, setShow] = useState(false);
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
              onClick={() => setShow((v) => !v)}
              className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-sm font-semibold text-text-2 hover:text-ink max-sm:min-h-11"
            >
              {show ? "Ocultar indicadores" : `Ver ${skill.criteria.length} indicadores`}
              <ChevronDown className={cn("size-4 transition-transform", show && "rotate-180")} aria-hidden="true" />
            </button>
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
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-6 text-text-2">
              {skill.criteria.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
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
