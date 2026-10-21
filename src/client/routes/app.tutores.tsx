import { createFileRoute } from "@tanstack/react-router";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bot, Copy, MoreHorizontal, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { optionalEnum, searchParams } from "@client/lib/search";
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Menu } from "@client/components/ui/controls";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { cn } from "@client/lib/cn";
import { errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { usePageTitle } from "@client/lib/page-title";
import { newRequestId, useSingleFlight } from "@client/features/activities/single-flight";
import { useTutorMutations, useTutors } from "@client/features/tutors/api";
import { TutorEditorDialog } from "@client/features/tutors/tutor-editor";
import { UseTutorDialog } from "@client/features/tutors/use-tutor-dialog";
import { TutorTypeTile, helpLabel, typeLabel } from "@client/features/tutors/tutor-visual";
import { TUTOR_TYPE_INFO } from "@shared/domain/pedagogy";
import { tutorGroup } from "@shared/domain/tutor-presets";
import type { TutorSummary } from "@shared/contracts/tutors";

const FILTERS = [
  { value: "todos", label: "Todos" },
  { value: "enfoques", label: "Enfoques" },
  { value: "formatos", label: "Formatos" },
  { value: "mios", label: "Míos" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

export const Route = createFileRoute("/app/tutores")({
  validateSearch: searchParams({ filtro: optionalEnum(["todos", "enfoques", "formatos", "mios"]) }),
  component: TutorsPage,
});

function matches(t: TutorSummary, f: Filter) {
  if (f === "mios") return !t.presetKey;
  if (f === "enfoques") return tutorGroup(t.tutorType) === "focus";
  if (f === "formatos") return tutorGroup(t.tutorType) === "format";
  return true;
}

function TutorsPage() {
  const { filtro = "todos" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useTutors();
  const m = useTutorMutations();
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [using, setUsing] = useState<TutorSummary | null>(null);
  const [restoring, setRestoring] = useState<TutorSummary | null>(null);
  const [deleting, setDeleting] = useState<TutorSummary | null>(null);

  usePageTitle("Mis tutores");
  const startDuplicate = useSingleFlight(m.duplicate.isPending);

  const counts = useMemo(() => {
    const list = q.data ?? [];
    return Object.fromEntries(FILTERS.map((f) => [f.value, list.filter((t) => matches(t, f.value)).length])) as Record<Filter, number>;
  }, [q.data]);

  const sections = useMemo(() => {
    const list = (q.data ?? []).filter((t) => matches(t, filtro));
    if (filtro === "mios") return list.length ? [{ key: "mine", title: "Creados por vos", items: list }] : [];
    const mine = list.filter((t) => !t.presetKey);
    const focus = list.filter((t) => t.presetKey && tutorGroup(t.tutorType) === "focus");
    const format = list.filter((t) => t.presetKey && tutorGroup(t.tutorType) === "format");
    return [
      { key: "mine", title: "Creados por vos", items: mine },
      { key: "focus", title: "Enfoques del pensamiento", description: "Qué tipo de pensamiento trabaja la conversación.", items: focus },
      { key: "format", title: "Formatos de actividad", description: "Cómo se organiza la conversación con el tutor.", items: format },
    ].filter((s) => s.items.length);
  }, [q.data, filtro]);

  const duplicate = (t: TutorSummary) => {
    if (!startDuplicate()) return;
    m.duplicate.mutate({ id: t.id, requestId: newRequestId() }, {
      onSuccess: (r) => {
        toast.success(`Creaste «${r.tutor.name}»`);
        setEditing({ id: r.tutor.id });
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <>
      <PageHeader
        title="Mis tutores"
        description="Un tutor define cómo conversa la IA con tus alumnos en una actividad: qué pregunta, cuánto ayuda y cuándo da por terminada la charla. Acá están todos los de la app para que los ajustes, y podés crear los tuyos."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ id: null })}>
            Nuevo tutor
          </Button>
        }
      />

      <div role="group" aria-label="Filtrar tutores" className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filtro === f.value}
            onClick={() => void navigate({ search: f.value === "todos" ? {} : { filtro: f.value }, replace: true })}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
              filtro === f.value ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-text-2 hover:border-ink/40 hover:text-ink",
            )}
          >
            {f.label}
            {q.data ? <span className="tabular text-xs">{counts[f.value]}</span> : null}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <SkeletonList rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : sections.length === 0 ? (
        <EmptyState
          icon={<Bot className="size-8" />}
          title="Todavía no creaste tutores propios"
          description="Podés crear uno desde cero o duplicar uno de los incluidos y ajustarlo a tu clase."
          action={
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ id: null })}>
              Crear un tutor
            </Button>
          }
        />
      ) : (
        <div className="grid gap-8">
          {sections.map((s) => (
            <section key={s.key} aria-labelledby={`sec-${s.key}`}>
              <div className="mb-3">
                <h2 id={`sec-${s.key}`} className="font-display text-xl font-semibold text-ink">
                  {s.title}
                </h2>
                {"description" in s && s.description ? <p className="mt-0.5 text-sm text-text-2">{s.description}</p> : null}
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {s.items.map((t) => (
                  <li key={t.id}>
                    <TutorCard
                      tutor={t}
                      onOpen={() => setEditing({ id: t.id })}
                      onUse={() => setUsing(t)}
                      onDuplicate={() => duplicate(t)}
                      onRestore={() => setRestoring(t)}
                      onDelete={() => setDeleting(t)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <TutorEditorDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        tutorId={editing?.id ?? null}
        onUse={(t) => {
          setEditing(null);
          setUsing(t);
        }}
        onCreated={(t) => setEditing({ id: t.id })}
      />
      <UseTutorDialog tutor={using} open={using !== null} onOpenChange={(o) => !o && setUsing(null)} />
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && setRestoring(null)}
        title="¿Restaurar el original?"
        description={<p>Vuelven los textos y el nivel de ayuda con los que viene «{restoring?.name}». Las actividades que ya lo usan no cambian.</p>}
        confirmLabel="Restaurar original"
        variant="primary"
        loading={m.restore.isPending}
        onConfirm={() => {
          if (!restoring) return;
          m.restore.mutate(restoring.id, {
            onSuccess: () => {
              toast.success("Tutor restaurado");
              setRestoring(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`¿Eliminar «${deleting?.name ?? ""}»?`}
        description={
          <p>
            Se borra de Mis tutores.{" "}
            {deleting?.usedInActivities
              ? `Las ${plural(deleting.usedInActivities, "actividad", "actividades")} que lo usan conservan la configuración que copiaron.`
              : "Ninguna actividad lo usa."}
          </p>
        }
        confirmLabel="Eliminar tutor"
        loading={m.remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          m.remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Tutor eliminado");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
    </>
  );
}

function TutorCard({
  tutor: t,
  onOpen,
  onUse,
  onDuplicate,
  onRestore,
  onDelete,
}: {
  tutor: TutorSummary;
  onOpen: () => void;
  onUse: () => void;
  onDuplicate: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const info = TUTOR_TYPE_INFO[t.tutorType];
  const showType = !t.presetKey || t.name !== typeLabel(t.tutorType);
  const uid = useId();
  return (
    // The whole card opens the tutor, but the button is only the name: its accessible name is exactly
    // the visible text (WCAG 2.5.3, D15); type, description and badges are its description.
    <article className="relative flex h-full flex-col rounded-lg border border-line bg-surface p-5 pr-14 shadow-1 transition-[border-color,box-shadow] has-[.tutor-open:focus-visible]:outline-2 has-[.tutor-open:focus-visible]:outline-offset-2 has-[.tutor-open:focus-visible]:outline-lilac-ink hover:border-line-strong hover:shadow-2">
      <div className="flex items-start gap-3">
        <TutorTypeTile type={t.tutorType} />
        <div className="min-w-0">
          <h3 className="font-display text-lg leading-snug font-semibold text-ink">
            <button
              type="button"
              onClick={onOpen}
              aria-describedby={[showType ? `${uid}-type` : "", info ? `${uid}-desc` : "", `${uid}-badges`].filter(Boolean).join(" ")}
              className="tutor-open text-left outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']"
            >
              {t.name}
            </button>
          </h3>
          {showType ? (
            <p id={`${uid}-type`} className="text-sm text-text-2">
              {typeLabel(t.tutorType)}
            </p>
          ) : null}
        </div>
      </div>
      {info ? (
        <p id={`${uid}-desc`} className="mt-3 line-clamp-3 text-sm leading-6 text-text-2">
          {info.description}
        </p>
      ) : null}
      <p id={`${uid}-badges`} className="mt-auto flex flex-wrap gap-1.5 pt-4">
        <Badge tone="neutral">{helpLabel(t.helpLevel)}</Badge>
        {t.customized ? <Badge tone="lilac">Editado</Badge> : null}
        {!t.presetKey ? <Badge tone="ink">Propio</Badge> : null}
        {t.usedInActivities ? <Badge tone="leaf">{plural(t.usedInActivities, "actividad", "actividades")}</Badge> : null}
      </p>
      <div className="absolute top-3 right-3 z-10">
        <Menu
          trigger={
            <Button variant="ghost" size="icon" aria-label={`Más opciones de ${t.name}`} className="size-11">
              <MoreHorizontal className="size-5" />
            </Button>
          }
          items={[
            { label: "Editar", icon: <Pencil className="size-4" />, onSelect: onOpen },
            { label: "Usar en una actividad nueva", icon: <Sparkles className="size-4" />, onSelect: onUse },
            { label: "Duplicar", icon: <Copy className="size-4" />, onSelect: onDuplicate },
            ...(t.presetKey
              ? t.customized
                ? [{ label: "Restaurar original", icon: <RotateCcw className="size-4" />, onSelect: onRestore }]
                : []
              : ["separator" as const, { label: "Eliminar", icon: <Trash2 className="size-4" />, danger: true, onSelect: onDelete }]),
          ]}
        />
      </div>
    </article>
  );
}
