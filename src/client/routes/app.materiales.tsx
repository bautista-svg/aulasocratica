import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Link2, NotebookPen, Search, X } from "lucide-react";
import { EmptyState, ErrorState, Notice, PageHeader, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Input, Select } from "@client/components/ui/field";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { cn } from "@client/lib/cn";
import { errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { NO_FILTERS, useMaterialMutations, useMaterials, type MaterialFilters } from "@client/features/materials/api";
import { UploadZone } from "@client/features/materials/upload-zone";
import { MaterialRow } from "@client/features/materials/material-row";
import { MaterialFormDialog } from "@client/features/materials/material-form-dialog";
import { TextPreviewDialog } from "@client/features/materials/text-preview-dialog";
import { AttachDialog } from "@client/features/materials/attach-dialog";
import type { MaterialSummary } from "@shared/contracts/materials";

export const Route = createFileRoute("/app/materiales")({
  component: MaterialsPage,
});

const NO_FOLDER = "__none__";

function MaterialsPage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<MaterialFilters>(NO_FILTERS);
  const q = useMaterials(filters);
  const mut = useMaterialMutations();
  const [form, setForm] = useState<null | { kind: "new-text" } | { kind: "new-link" } | { kind: "edit"; id: string }>(null);
  const [preview, setPreview] = useState<MaterialSummary | null>(null);
  const [using, setUsing] = useState<MaterialSummary | null>(null);
  const [deleting, setDeleting] = useState<MaterialSummary | null>(null);

  useEffect(() => {
    document.title = "Mis materiales · Aula Socrática";
  }, []);
  // Search as you type (debounced).
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 300);
    return () => clearTimeout(t);
  }, [search]);

  const data = q.data;
  const folders = useMemo(() => (data?.folders ?? []).map((f) => f.name), [data?.folders]);
  const filtered = Boolean(filters.q.trim() || filters.folder !== null || filters.tag);
  const clear = () => {
    setSearch("");
    setFilters(NO_FILTERS);
  };

  return (
    <>
      <PageHeader
        title="Mis materiales"
        description="Guardá una sola vez tus PDF, Word, fotos, textos y enlaces, y usalos en cualquier actividad. Los archivos se leen completos, sin límite de páginas."
        actions={
          <>
            <Button variant="secondary" icon={<NotebookPen className="size-4" />} onClick={() => setForm({ kind: "new-text" })}>
              Escribir texto
            </Button>
            <Button variant="secondary" icon={<Link2 className="size-4" />} onClick={() => setForm({ kind: "new-link" })}>
              Agregar enlace
            </Button>
          </>
        }
      />

      <UploadZone className="mb-6" />

      {data && data.total >= data.limit - 50 ? (
        <Notice tone="amber" className="mb-5">
          Tenés {data.total} de {data.limit} materiales. Borrá los que ya no uses para sumar otros.
        </Notice>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_240px]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-3" aria-hidden="true" />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, etiqueta o contenido" aria-label="Buscar materiales" className="pl-10" />
        </div>
        <Select
          aria-label="Carpeta"
          value={filters.folder === null ? "" : filters.folder === "" ? NO_FOLDER : filters.folder}
          onChange={(e) => setFilters((f) => ({ ...f, folder: e.target.value === "" ? null : e.target.value === NO_FOLDER ? "" : e.target.value }))}
        >
          <option value="">Todas las carpetas</option>
          <option value={NO_FOLDER}>Sin carpeta</option>
          {(data?.folders ?? []).map((f) => (
            <option key={f.name} value={f.name}>
              {f.name} ({f.count})
            </option>
          ))}
        </Select>
      </div>

      {data?.tags.length ? (
        <div role="group" aria-label="Filtrar por etiqueta" className="mb-5 flex flex-wrap gap-2">
          {data.tags.map((t) => {
            const on = filters.tag === t.name;
            return (
              <button
                key={t.name}
                type="button"
                aria-pressed={on}
                onClick={() => setFilters((f) => ({ ...f, tag: on ? null : t.name }))}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors",
                  on ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-text-2 hover:border-ink/40 hover:text-ink",
                )}
              >
                #{t.name}
                <span className={cn("tabular text-xs", on ? "text-white/80" : "text-text-3")}>{t.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {q.isPending ? (
        <SkeletonList rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.materials.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Search className="size-8" />}
            title="No hay materiales que coincidan"
            description="Probá con otra palabra, otra carpeta u otra etiqueta."
            action={
              <Button variant="secondary" icon={<X className="size-4" />} onClick={clear}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<FolderOpen className="size-8" />}
            title="Tu biblioteca está vacía"
            description="Subí un PDF, un Word o una foto del tema con el recuadro de arriba, o escribí un texto. Después lo usás en cualquier actividad o en Crear con IA."
            action={
              <Button icon={<NotebookPen className="size-4" />} variant="secondary" onClick={() => setForm({ kind: "new-text" })}>
                Escribir un texto
              </Button>
            }
          />
        )
      ) : (
        <>
          <p className="mb-3 text-sm text-text-2" aria-live="polite">
            {plural(q.data.materials.length, "material", "materiales")}
            {filtered ? " con estos filtros" : ""}
            {filtered ? (
              <button type="button" onClick={clear} className="ml-2 font-semibold text-lilac-ink underline decoration-lilac underline-offset-4">
                Limpiar filtros
              </button>
            ) : null}
          </p>
          <ul className="grid gap-3 lg:grid-cols-2">
            {q.data.materials.map((m) => (
              <li key={m.id}>
                <MaterialRow
                  material={m}
                  onPreview={() => setPreview(m)}
                  onEdit={() => setForm({ kind: "edit", id: m.id })}
                  onDelete={() => setDeleting(m)}
                  onUse={() => setUsing(m)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <MaterialFormDialog mode={form} onOpenChange={(o) => !o && setForm(null)} folders={folders} />
      <TextPreviewDialog material={preview} onOpenChange={(o) => !o && setPreview(null)} />
      <AttachDialog material={using} onOpenChange={(o) => !o && setUsing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`¿Eliminar «${deleting?.title ?? ""}»?`}
        description={
          <p>
            Se borra de Mis materiales{deleting?.kind === "file" ? " junto con el archivo guardado" : ""}. Las actividades donde ya lo usaste conservan su copia.
          </p>
        }
        confirmLabel="Eliminar"
        loading={mut.remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          mut.remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Material eliminado");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
    </>
  );
}
