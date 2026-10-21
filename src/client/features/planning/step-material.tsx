import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, Library, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Dialog } from "@client/components/ui/dialog";
import { Checkbox } from "@client/components/ui/controls";
import { Field, Input, Textarea } from "@client/components/ui/field";
import { ErrorState, Notice, Skeleton } from "@client/components/ui/misc";
import { errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { NO_FILTERS, isBusy, useMaterialMutations, useMaterials } from "@client/features/materials/api";
import { UploadZone } from "@client/features/materials/upload-zone";
import { MaterialIcon, MaterialStatus, materialMeta } from "@client/features/materials/material-parts";
import { TextPreviewDialog } from "@client/features/materials/text-preview-dialog";
import { MAX_PICK } from "@shared/domain/library";
import { MAX_EXTRA_TEXT } from "@shared/contracts/planning";
import type { MaterialSummary } from "@shared/contracts/materials";
import type { WizardState } from "./wizard-state";

export function StepMaterial({
  state: s,
  update,
  errors,
}: {
  state: WizardState;
  update: (p: Partial<WizardState> | ((s: WizardState) => Partial<WizardState>)) => void;
  errors: Record<string, string>;
}) {
  const lib = useMaterials(NO_FILTERS);
  const mut = useMaterialMutations();
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState<MaterialSummary | null>(null);
  const byId = useMemo(() => new Map((lib.data?.materials ?? []).map((m) => [m.id, m])), [lib.data]);
  const selected = s.materialIds.map((id) => byId.get(id)).filter((m): m is MaterialSummary => Boolean(m));
  // Ids not in the library list: just uploaded (list still refreshing) or deleted meanwhile.
  const unknown = lib.data ? s.materialIds.filter((id) => !byId.has(id)) : [];

  const add = (m: MaterialSummary) =>
    update((cur) => (cur.materialIds.includes(m.id) || cur.materialIds.length >= MAX_PICK ? {} : { materialIds: [...cur.materialIds, m.id] }));
  const remove = (id: string) => update((cur) => ({ materialIds: cur.materialIds.filter((x) => x !== id) }));
  const busyCount = selected.filter(isBusy).length;

  return (
    <div className="grid gap-6">
      <UploadZone compact allowAudio={false} maxFiles={MAX_PICK - s.materialIds.length} onUploaded={add} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-semibold text-text">
          Material elegido <span className="font-normal text-text-3">({s.materialIds.length} de {MAX_PICK})</span>
        </h3>
        <Button variant="secondary" icon={<Library className="size-4" />} onClick={() => setPicking(true)}>
          Elegir de Mis materiales
        </Button>
      </div>

      {lib.isPending && s.materialIds.length ? (
        <Skeleton className="h-16 w-full" />
      ) : lib.isError ? (
        <ErrorState error={lib.error} onRetry={() => void lib.refetch()} />
      ) : selected.length === 0 && unknown.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-4 py-4 text-sm leading-6 text-text-2">
          Todavía no elegiste material. Es opcional: sin material, la IA propone a partir del tema y los datos de la clase.
        </p>
      ) : (
        <ul className="grid gap-2" aria-live="polite">
          {unknown.map((id) => (
            <li key={id} className="flex items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-3 text-sm text-text-2">
              <span className="min-w-0 flex-1">{lib.isFetching ? "Cargando el material…" : "Este material ya no está en Mis materiales."}</span>
              {!lib.isFetching ? (
                <Button size="sm" variant="ghost" onClick={() => remove(id)}>
                  Quitar
                </Button>
              ) : null}
            </li>
          ))}
          {selected.map((m) => (
            <li key={m.id} className="flex gap-3 rounded-md border border-line bg-surface px-3.5 py-3">
              <MaterialIcon material={m} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold break-words text-text">{m.title}</p>
                <p className="text-[13px] text-text-3">{materialMeta(m)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <MaterialStatus material={m} showReady />
                  {m.processingStatus === "failed" ? <span className="text-[13px] font-medium text-rose">{m.processingError}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                {m.processingStatus === "failed" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RefreshCw className="size-4" />}
                    onClick={() => mut.retry.mutate(m.id, { onError: (e) => toast.error(errorMessage(e)) })}
                    aria-label={`Reintentar la lectura de ${m.title}`}
                  >
                    <span className="hidden sm:inline">Reintentar</span>
                  </Button>
                ) : null}
                {m.processingStatus === "ready" && m.textChars > 0 ? (
                  <Button size="icon" variant="ghost" onClick={() => setPreview(m)} aria-label={`Ver el texto de ${m.title}`}>
                    <Eye className="size-4" />
                  </Button>
                ) : null}
                <Button size="icon" variant="ghost" onClick={() => remove(m.id)} aria-label={`Quitar ${m.title} de esta clase`}>
                  <X className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {busyCount ? (
        <Notice tone="ink">
          {plural(busyCount, "archivo se está", "archivos se están")} leyendo. Podés seguir: al generar las propuestas esperamos a que terminen.
        </Notice>
      ) : null}
      {errors.materials ? (
        <p role="alert" className="text-sm font-medium text-rose">
          {errors.materials}
        </p>
      ) : null}

      <Field
        label="Texto para la clase"
        optional
        error={errors.extraText}
        hint="Pegá un texto, una consigna o tus notas. La IA lo lee y, al crear la actividad, se suma a su material escrito."
        counter={{ value: s.extraText.length, max: MAX_EXTRA_TEXT }}
      >
        {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={s.extraText} onChange={(e) => update({ extraText: e.target.value })} minRows={3} maxRows={12} />}
      </Field>

      <LibraryPicker
        open={picking}
        onOpenChange={setPicking}
        materials={lib.data?.materials ?? []}
        loading={lib.isPending}
        selected={s.materialIds}
        onChange={(ids) => update({ materialIds: ids })}
      />
      <TextPreviewDialog material={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </div>
  );
}

export function materialErrors(s: WizardState, library: MaterialSummary[] | undefined): Record<string, string> {
  const e: Record<string, string> = {};
  if (s.materialIds.length > MAX_PICK) e.materials = `Podés elegir hasta ${MAX_PICK} materiales.`;
  if (library && s.materialIds.some((id) => !library.some((m) => m.id === id))) e.materials = "Quitá los materiales que ya no están en Mis materiales.";
  const failed = (library ?? []).filter((m) => s.materialIds.includes(m.id) && m.processingStatus === "failed");
  if (failed.length) e.materials = `No pudimos leer ${failed.map((m) => `«${m.title}»`).join(", ")}. Reintentá la lectura o quitalo para seguir.`;
  if (s.extraText.length > MAX_EXTRA_TEXT) e.extraText = `Usá hasta ${MAX_EXTRA_TEXT} caracteres.`;
  return e;
}

function LibraryPicker({
  open,
  onOpenChange,
  materials,
  loading,
  selected,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  materials: MaterialSummary[];
  loading: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>(selected);
  useEffect(() => {
    if (open) {
      setPicked(selected);
      setQ("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const shown = materials.filter((m) => {
    const t = q.trim().toLowerCase();
    return !t || [m.title, m.folder, m.fileName ?? "", ...m.tags].some((x) => x.toLowerCase().includes(t));
  });
  const toggle = (id: string, on: boolean) => {
    if (on && picked.length >= MAX_PICK) {
      toast.error(`Podés elegir hasta ${MAX_PICK} materiales.`);
      return;
    }
    setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Elegir de Mis materiales"
      description={`Elegí hasta ${MAX_PICK}. Los archivos que no se pudieron leer no se pueden usar.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onChange(picked);
              onOpenChange(false);
            }}
          >
            {picked.length ? `Usar ${plural(picked.length, "material", "materiales")}` : "Listo"}
          </Button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-3" aria-hidden="true" />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" aria-label="Buscar en Mis materiales" className="pl-10" />
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : materials.length === 0 ? (
        <p className="text-sm text-text-2">Tu biblioteca está vacía. Subí archivos con el recuadro de este paso: quedan guardados en Mis materiales.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-text-2">No hay materiales que coincidan.</p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((m) => {
            const on = picked.includes(m.id);
            const failed = m.processingStatus === "failed";
            return (
              <li key={m.id} className="rounded-md border border-line px-3.5 py-3">
                <Checkbox
                  checked={on}
                  disabled={failed && !on}
                  onCheckedChange={(v) => toggle(m.id, v)}
                  label={<span className="font-semibold">{m.title}</span>}
                  description={
                    <span className="flex flex-wrap items-center gap-2">
                      {materialMeta(m)}
                      <MaterialStatus material={m} />
                    </span>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
