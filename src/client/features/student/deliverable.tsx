// "Tu entrega": the file or link a student hands in with the final answer, when the activity asks
// for one. A file is uploaded as soon as it is picked (big photos are shrunk first); a link
// (Google Drive, Docs, Canva…) is saved when pasted. Either can be changed or removed until the
// work is sent.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, ImageIcon, Link2, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Input } from "@client/components/ui/field";
import { ApiError, errorMessage } from "@client/lib/api";
import { prepareImage } from "@client/features/activities/prepare-image";
import {
  DELIVERABLE_ACCEPT,
  DELIVERABLE_URL_MAX,
  MAX_DELIVERABLE_LABEL,
  deliverableKindLabel,
  validateDeliverable,
  validateDeliverableLink,
} from "@shared/domain/deliverables";
import { formatBytes } from "@shared/domain/files";
import type { StudentDeliverable, StudentWorkspace } from "@shared/contracts/student";
import { setWorkspace, studentApi } from "./api";

const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "");

export function DeliverableFileLine({ file, link = true }: { file: StudentDeliverable; link?: boolean }) {
  const isLink = file.kind === "link";
  const Icon = isLink ? Link2 : file.kind === "image" ? ImageIcon : FileText;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Icon className="size-5 shrink-0 text-lilac-ink" aria-hidden="true" />
      <span className="min-w-0">
        {link ? (
          <a
            href={file.url}
            target="_blank"
            rel={isLink ? "noopener noreferrer" : "noopener"}
            className="block truncate font-semibold text-ink underline decoration-ink/35 underline-offset-4 hover:decoration-ink"
          >
            {file.name}
          </a>
        ) : (
          <span className="block truncate font-semibold text-text">{file.name}</span>
        )}
        <span className="block truncate text-sm text-text-3">
          {isLink ? shortUrl(file.url) : `${deliverableKindLabel(file.kind)} · ${formatBytes(file.sizeBytes)}`}
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
  const [savingLink, setSavingLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Choosing (again): the two ways to hand in are shown while there is nothing or while changing it.
  const [changing, setChanging] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const required = workspace.activity.deliverableMode === "required";
  const file = workspace.deliverable;
  const busy = progress !== null || removing || savingLink;
  const choosing = !file || changing;

  async function run(work: () => Promise<{ workspace: StudentWorkspace }>, fallback: string, onError?: (err: unknown) => string | null) {
    onBusyChange(true);
    try {
      const r = await work();
      setWorkspace(qc, token, r.workspace);
      setChanging(false);
      setLinkOpen(false);
      setUrl("");
    } catch (err) {
      onStale(err);
      setError(onError?.(err) ?? (errorMessage(err) || fallback));
    } finally {
      onBusyChange(false);
    }
  }

  async function upload(picked: File) {
    setError(null);
    const prepared = picked.type.startsWith("image/") ? await prepareImage(picked) : picked;
    const check = validateDeliverable({ name: prepared.name, type: prepared.type, size: prepared.size });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setProgress(0);
    await run(
      () => studentApi.uploadDeliverable(token, prepared, (f) => setProgress(f)),
      "No se pudo subir el archivo. Probá de nuevo.",
      (err) => (err instanceof ApiError ? (err.fields.file ?? err.message) : null),
    );
    setProgress(null);
  }

  async function saveLink() {
    setError(null);
    const check = validateDeliverableLink(url);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setSavingLink(true);
    await run(
      () => studentApi.saveDeliverableLink(token, check.url),
      "No se pudo guardar el enlace. Probá de nuevo.",
      (err) => (err instanceof ApiError ? (err.fields.url ?? err.message) : null),
    );
    setSavingLink(false);
  }

  async function remove() {
    setError(null);
    setRemoving(true);
    await run(() => studentApi.removeDeliverable(token), "No se pudo quitar la entrega.");
    setRemoving(false);
  }

  return (
    <fieldset className="space-y-3 border-t border-line pt-5" aria-describedby="entrega-ayuda">
      <legend className="float-left flex w-full items-center gap-2 font-display text-lg font-semibold text-ink">
        <Paperclip className="size-[18px] text-lilac-ink" aria-hidden="true" />
        Tu entrega
        <span className="font-sans text-sm font-normal text-text-3">{required ? "obligatoria" : "opcional"}</span>
      </legend>
      <p className="clear-left pt-1 text-[15px] leading-6 whitespace-pre-wrap text-text-2">
        {workspace.activity.deliverablePrompt || "Subí el archivo con tu trabajo o pegá el enlace."}
      </p>

      {file && !changing ? (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <DeliverableFileLine file={file} />
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" icon={<Upload className="size-4" />} disabled={busy || disabled} onClick={() => setChanging(true)}>
              Cambiar
            </Button>
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} loading={removing} disabled={busy || disabled} onClick={() => void remove()}>
              Quitar
            </Button>
          </div>
        </div>
      ) : null}

      {choosing ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="secondary" size="lg" className="w-full sm:w-auto" icon={<Upload className="size-4" />} disabled={busy || disabled} onClick={() => input.current?.click()}>
              Elegir un archivo o sacar una foto
            </Button>
            <Button
              variant={linkOpen ? "lilac" : "ghost"}
              size="lg"
              className="w-full sm:w-auto"
              icon={<Link2 className="size-4" />}
              aria-expanded={linkOpen}
              disabled={busy || disabled}
              onClick={() => setLinkOpen((v) => !v)}
            >
              Pegar un enlace
            </Button>
            {changing ? (
              <Button variant="ghost" size="lg" className="w-full sm:w-auto" disabled={busy} onClick={() => (setChanging(false), setLinkOpen(false), setError(null))}>
                Cancelar
              </Button>
            ) : null}
          </div>
          {linkOpen ? (
            // Not a <form>: this sits inside the form that sends the work, and Enter must only save the link.
            <div className="space-y-2 rounded-md border border-line bg-paper p-3">
              <label htmlFor="entrega-enlace" className="text-sm font-semibold text-text">
                Enlace a tu trabajo (Google Drive, Docs, Canva…)
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="entrega-enlace"
                  type="text"
                  inputMode="url"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  placeholder="https://docs.google.com/…"
                  value={url}
                  maxLength={DELIVERABLE_URL_MAX}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void saveLink();
                  }}
                  aria-describedby="entrega-enlace-ayuda"
                />
                <Button className="shrink-0" loading={savingLink} disabled={busy || disabled || !url.trim()} onClick={() => void saveLink()}>
                  Guardar enlace
                </Button>
              </div>
              <p id="entrega-enlace-ayuda" className="text-[13px] leading-5 text-text-3">
                Si es de Google Drive, compartilo como «Cualquier persona con el enlace» para que tu docente lo pueda abrir.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
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
        PDF, Word, texto o una foto (JPG, PNG, WEBP), hasta {MAX_DELIVERABLE_LABEL}, o un enlace. Lo ve tu docente junto con tu respuesta.
      </p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-rose">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
