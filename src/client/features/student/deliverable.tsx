// "Tu entrega": the file a student hands in with the final answer, when the activity asks for one.
// The file is uploaded as soon as it is picked (big photos are shrunk first) and can be changed or
// removed until the work is sent.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { ApiError, errorMessage } from "@client/lib/api";
import { prepareImage } from "@client/features/activities/prepare-image";
import { DELIVERABLE_ACCEPT, MAX_DELIVERABLE_LABEL, validateDeliverable } from "@shared/domain/deliverables";
import { KIND_LABEL, formatBytes } from "@shared/domain/files";
import type { StudentDeliverable, StudentWorkspace } from "@shared/contracts/student";
import { setWorkspace, studentApi } from "./api";

export function DeliverableFileLine({ file, link = true }: { file: StudentDeliverable; link?: boolean }) {
  const Icon = file.kind === "image" ? ImageIcon : FileText;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Icon className="size-5 shrink-0 text-lilac-ink" aria-hidden="true" />
      <span className="min-w-0">
        {link ? (
          <a href={file.url} target="_blank" rel="noopener" className="block truncate font-semibold text-ink underline decoration-ink/35 underline-offset-4 hover:decoration-ink">
            {file.name}
          </a>
        ) : (
          <span className="block truncate font-semibold text-text">{file.name}</span>
        )}
        <span className="block text-sm text-text-3">
          {KIND_LABEL[file.kind]} · {formatBytes(file.sizeBytes)}
        </span>
      </span>
    </span>
  );
}

export function DeliverableField({
  token,
  workspace,
  onBusyChange,
  onStale,
  disabled,
}: {
  token: string;
  workspace: StudentWorkspace;
  onBusyChange: (busy: boolean) => void;
  onStale: (err: unknown) => void;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = workspace.activity.deliverableMode === "required";
  const file = workspace.deliverable;
  const busy = progress !== null || removing;

  async function upload(picked: File) {
    setError(null);
    const prepared = picked.type.startsWith("image/") ? await prepareImage(picked) : picked;
    const check = validateDeliverable({ name: prepared.name, type: prepared.type, size: prepared.size });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setProgress(0);
    onBusyChange(true);
    try {
      const r = await studentApi.uploadDeliverable(token, prepared, (f) => setProgress(f));
      setWorkspace(qc, token, r.workspace);
    } catch (err) {
      onStale(err);
      setError(err instanceof ApiError ? (err.fields.file ?? err.message) : errorMessage(err) || "No se pudo subir el archivo. Probá de nuevo.");
    } finally {
      setProgress(null);
      onBusyChange(false);
    }
  }

  async function remove() {
    setError(null);
    setRemoving(true);
    onBusyChange(true);
    try {
      const r = await studentApi.removeDeliverable(token);
      setWorkspace(qc, token, r.workspace);
    } catch (err) {
      onStale(err);
      setError(errorMessage(err) || "No se pudo quitar el archivo.");
    } finally {
      setRemoving(false);
      onBusyChange(false);
    }
  }

  return (
    <fieldset className="space-y-3 border-t border-line pt-5" aria-describedby="entrega-ayuda">
      <legend className="float-left flex w-full items-center gap-2 font-display text-lg font-semibold text-ink">
        <Paperclip className="size-[18px] text-lilac-ink" aria-hidden="true" />
        Tu entrega
        <span className="font-sans text-sm font-normal text-text-3">{required ? "obligatoria" : "opcional"}</span>
      </legend>
      <p className="clear-left pt-1 text-[15px] leading-6 whitespace-pre-wrap text-text-2">
        {workspace.activity.deliverablePrompt || "Subí el archivo con tu trabajo."}
      </p>

      {file ? (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <DeliverableFileLine file={file} />
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" icon={<Upload className="size-4" />} disabled={busy || disabled} onClick={() => input.current?.click()}>
              Cambiar
            </Button>
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} loading={removing} disabled={busy || disabled} onClick={() => void remove()}>
              Quitar
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="lg" className="w-full sm:w-auto" icon={<Upload className="size-4" />} disabled={busy || disabled} onClick={() => input.current?.click()}>
          Elegir un archivo o sacar una foto
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept={DELIVERABLE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) void upload(picked);
        }}
      />

      {progress !== null ? (
        <div className="space-y-1.5" role="status">
          <p className="text-sm font-semibold text-text">Subiendo… {Math.round(progress * 100)} %</p>
          <div className="h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
            <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
          </div>
        </div>
      ) : null}
      <p id="entrega-ayuda" className="text-sm text-text-3">
        PDF, Word, texto o una foto (JPG, PNG, WEBP), hasta {MAX_DELIVERABLE_LABEL}. Lo ve tu docente junto con tu respuesta.
      </p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-rose">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
