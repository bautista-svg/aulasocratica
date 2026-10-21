import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, ConfirmDialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { Field, FormError, Input, Textarea } from "@client/components/ui/field";
import { ErrorState, Skeleton } from "@client/components/ui/misc";
import { ApiError, errorMessage } from "@client/lib/api";
import { MAX_LINK_NOTE, MAX_TEXT_BODY, isSafeUrl, sanitizeTags } from "@shared/domain/library";
import type { MaterialDetail } from "@shared/contracts/materials";
import { useMaterial, useMaterialMutations } from "./api";
import { useRequestId, useSingleFlight } from "@client/features/activities/single-flight";

type Mode = { kind: "new-text" } | { kind: "new-link" } | { kind: "edit"; id: string };
interface Values {
  title: string;
  url: string;
  body: string;
  folder: string;
  tags: string;
}
const EMPTY: Values = { title: "", url: "", body: "", folder: "", tags: "" };

/** New written text, new link, or edit of any material (files: only name, folder and tags). */
export function MaterialFormDialog({
  mode,
  onOpenChange,
  folders,
  onCreated,
}: {
  mode: Mode | null;
  onOpenChange: (o: boolean) => void;
  folders: string[];
  onCreated?: (m: MaterialDetail) => void;
}) {
  const open = mode !== null;
  const editId = mode?.kind === "edit" ? mode.id : null;
  const detail = useMaterial(editId);
  const mut = useMaterialMutations();
  const [values, setValues] = useState<Values>(EMPTY);
  const [initial, setInitial] = useState<Values>(EMPTY);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const listId = useId();

  const kind: "text" | "link" | "file" = mode?.kind === "new-text" ? "text" : mode?.kind === "new-link" ? "link" : (detail.data?.kind ?? "file");

  useEffect(() => {
    if (!mode) {
      setLoadedFor(null);
      return;
    }
    const key = mode.kind === "edit" ? mode.id : mode.kind;
    if (loadedFor === key) return;
    if (mode.kind !== "edit") {
      setValues(EMPTY);
      setInitial(EMPTY);
      setLoadedFor(key);
      mut.create.reset();
    } else if (detail.data?.id === mode.id) {
      const d = detail.data;
      const v = { title: d.title, url: d.url ?? "", body: d.body, folder: d.folder, tags: d.tags.join(", ") };
      setValues(v);
      setInitial(v);
      setLoadedFor(key);
      mut.update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, detail.data, loadedFor]);

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);
  const error = editId ? mut.update.error : mut.create.error;
  const fields = error instanceof ApiError ? error.fields : {};
  const pending = mut.create.isPending || mut.update.isPending;
  const start = useSingleFlight(pending);
  const requestId = useRequestId(open);
  const loading = Boolean(editId) && loadedFor !== editId;
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const localErrors: Partial<Record<keyof Values, string>> = {};
  if (kind === "link" && values.url.trim() && !isSafeUrl(values.url)) localErrors.url = "Revisá el enlace: tiene que empezar con https:// o http://";
  const canSave = values.title.trim() && (kind !== "text" || values.body.trim()) && (kind !== "link" || (values.url.trim() && !localErrors.url));

  const close = (o: boolean) => {
    if (!o && dirty && !pending) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(o);
  };

  const submit = () => {
    // A double click (or Enter + click) saves one material, never two.
    if (!canSave || !start()) return;
    const tags = sanitizeTags(values.tags);
    if (editId) {
      mut.update.mutate(
        {
          id: editId,
          data: {
            title: values.title,
            folder: values.folder,
            tags,
            ...(kind === "text" || kind === "link" ? { body: values.body } : {}),
            ...(kind === "link" ? { url: values.url } : {}),
          },
        },
        {
          onSuccess: () => {
            setInitial(values);
            toast.success("Cambios guardados");
            onOpenChange(false);
          },
        },
      );
    } else {
      const data =
        kind === "link"
          ? { kind: "link" as const, title: values.title, url: values.url.trim(), body: values.body, folder: values.folder, tags, requestId }
          : { kind: "text" as const, title: values.title, body: values.body, folder: values.folder, tags, requestId };
      mut.create.mutate(data, {
        onSuccess: (r) => {
          setInitial(values);
          toast.success(kind === "link" ? "Enlace guardado" : "Texto guardado");
          onOpenChange(false);
          onCreated?.(r.material);
        },
      });
    }
  };

  const title = editId ? "Editar material" : kind === "link" ? "Agregar enlace" : "Escribir texto";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={close}
        title={title}
        wide={kind === "text"}
        description={
          kind === "link"
            ? "El tutor no abre enlaces: usa la descripción que escribas como referencia."
            : kind === "text"
              ? "Un texto que escribís o pegás: el tutor y la IA lo leen completo."
              : "Del archivo podés cambiar el nombre, la carpeta y las etiquetas."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button loading={pending} disabled={!canSave || loading || (Boolean(editId) && !dirty)} onClick={submit}>
              {editId ? "Guardar cambios" : "Guardar"}
            </Button>
          </>
        }
      >
        {editId && detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : loading ? (
          <div className="grid gap-4" aria-busy="true" aria-label="Cargando material">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label="Nombre" error={fields.title}>
              {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={values.title} onChange={set("title")} maxLength={200} autoFocus />}
            </Field>
            {kind === "link" ? (
              <Field label="Enlace" error={localErrors.url ?? fields.url}>
                {(p) => (
                  <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} type="url" inputMode="url" placeholder="https://" value={values.url} onChange={set("url")} maxLength={2000} />
                )}
              </Field>
            ) : null}
            {kind === "text" ? (
              <Field label="Texto" error={fields.body} counter={{ value: values.body.length, max: MAX_TEXT_BODY }}>
                {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={values.body} onChange={set("body")} minRows={8} maxRows={18} />}
              </Field>
            ) : null}
            {kind === "link" ? (
              <Field label="Descripción" optional error={fields.body} hint="Qué hay en el enlace: el tutor usa esto como referencia." counter={{ value: values.body.length, max: MAX_LINK_NOTE }}>
                {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={values.body} onChange={set("body")} minRows={3} />}
              </Field>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Carpeta" optional error={fields.folder} hint="Escribí una nueva o elegí una que ya tengas.">
                {(p) => (
                  <>
                    <Input id={p.id} aria-describedby={p.describedBy} list={listId} value={values.folder} onChange={set("folder")} maxLength={80} />
                    <datalist id={listId}>
                      {folders.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              <Field label="Etiquetas" optional error={fields.tags} hint="Separadas por comas. Hasta 10.">
                {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={values.tags} onChange={set("tags")} placeholder="fracciones, repaso" />}
              </Field>
            </div>
            <FormError message={error && !Object.keys(fields).length ? errorMessage(error) : null} />
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="¿Descartar los cambios?"
        description={<p>Lo que escribiste todavía no se guardó.</p>}
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        onConfirm={() => {
          setConfirmDiscard(false);
          setValues(initial);
          onOpenChange(false);
        }}
      />
    </>
  );
}
