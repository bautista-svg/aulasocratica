// Files attached to an activity: drag & drop or picker (camera/gallery on phones), one
// upload per file with real progress, background reading with live status, retry,
// teacher note for audio, text preview and removal. Files are saved as soon as they
// finish uploading (they do not wait for "Guardar cambios").
import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Download,
  FileAudio,
  FileText,
  FileType2,
  Image as ImageIcon,
  MoreHorizontal,
  RotateCcw,
  ScrollText,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Menu } from "@client/components/ui/controls";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Field, Textarea } from "@client/components/ui/field";
import { Badge, ErrorState, Skeleton } from "@client/components/ui/misc";
import { Spinner } from "@client/components/ui/spinner";
import { cn } from "@client/lib/cn";
import { errorMessage, uploadWithProgress } from "@client/lib/api";
import { fmtRelative, plural } from "@client/lib/format";
import {
  FILE_ACCEPT,
  MAX_FILES_PER_ACTIVITY,
  PROCESSING_LABEL,
  formatBytes,
  validateUpload,
  type FileKind,
} from "@shared/domain/files";
import { FULL_MATERIAL_CHARS } from "@shared/domain/material-select";
import { ACTIVITY_LIMITS, type ActivityFile, type UploadFilesResponse } from "@shared/contracts/activities";
import { activityKeys, addUploadedFiles, fetchFileText, fileDownloadUrl, useActivityFiles, useFileMutations } from "./api";
import { ProgressBar } from "./parts";
import { prepareImage } from "./prepare-image";
import { useCan } from "@client/features/sharing/role";

const ICON: Record<FileKind, typeof FileText> = { pdf: FileText, image: ImageIcon, docx: FileType2, text: ScrollText, audio: FileAudio };
const STUCK_MS = 2 * 60_000;

interface Upload {
  key: string;
  name: string;
  size: number;
  progress: number;
  error?: string;
}

/** True when the tutor gets excerpts instead of the whole material (same rule as selectMaterial). */
export function isLongMaterial(writtenChars: number, files: ActivityFile[]) {
  const total = writtenChars + files.reduce((n, f) => n + (f.processingStatus === "ready" ? f.textChars + f.teacherNote.length : 0), 0);
  return total > FULL_MATERIAL_CHARS;
}

export function MaterialFiles({ activityId, writtenChars }: { activityId: string; writtenChars: number }) {
  const files = useActivityFiles(activityId);
  const qc = useQueryClient();
  const fileMutations = useFileMutations(activityId);
  const inputRef = useRef<HTMLInputElement>(null);
  /** "Subir otra versión" of a file that could not be read: the next picked file replaces it. */
  const replacing = useRef<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [announce, setAnnounce] = useState("");
  // A reader of a shared classroom sees the files but has no place to drop new ones.
  const canEdit = useCan("edit");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const hintId = useId();

  const list = files.data ?? [];
  const inFlight = uploads.filter((u) => !u.error).length;
  // Files that could not be read do not count toward the limit (the server applies the same rule).
  const failed = list.filter((f) => f.processingStatus === "failed").length;
  const usable = list.length - failed;
  const remaining = MAX_FILES_PER_ACTIVITY - usable - inFlight;
  const long = isLongMaterial(writtenChars, list);

  const update = (key: string, patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function pick(fileList: FileList | File[] | null) {
    const replaceId = replacing.current;
    replacing.current = null;
    const picked = Array.from(fileList ?? []).slice(0, replaceId ? 1 : undefined);
    if (!picked.length) return;
    let room = remaining;
    for (const file of picked) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const check = validateUpload(file);
      if (!check.ok) {
        setUploads((u) => [...u, { key, name: file.name, size: file.size, progress: 0, error: check.error }]);
        continue;
      }
      if (room <= 0) {
        setUploads((u) => [
          ...u,
          { key, name: file.name, size: file.size, progress: 0, error: `"${file.name}": la actividad ya tiene ${MAX_FILES_PER_ACTIVITY} archivos, el máximo.` },
        ]);
        continue;
      }
      room--;
      setUploads((u) => [...u, { key, name: file.name, size: file.size, progress: 0 }]);
      // One upload at a time: steady progress and no overload on slow school connections.
      queue.current = queue.current.then(() => send(key, file, replaceId));
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function send(key: string, original: File, replaceId: string | null = null) {
    try {
      const file = original.type.startsWith("image/") ? await prepareImage(original) : original;
      const form = new FormData();
      form.append("file", file);
      const r = await uploadWithProgress<UploadFilesResponse>(`/api/activities/${activityId}/files`, form, (p) => update(key, { progress: p }));
      addUploadedFiles(qc, activityId, r.files);
      void qc.invalidateQueries({ queryKey: activityKeys.files(activityId) });
      setUploads((u) => u.filter((x) => x.key !== key));
      setAnnounce(`Se subió ${original.name}. Ahora se está leyendo.`);
      if (replaceId) {
        // The new version is in: the one that could not be read goes away.
        await fileMutations.remove.mutateAsync(replaceId).catch(() => toast.error("Se subió la versión nueva, pero no se pudo quitar la anterior. Quitala desde su menú."));
      }
    } catch (e) {
      update(key, { error: errorMessage(e) || `No se pudo subir "${original.name}".` });
    }
  }

  return (
    <div>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!canEdit) return;
          replacing.current = null;
          pick(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-ink bg-ink-soft/60" : "border-line-strong bg-paper/60",
          !canEdit && "hidden",
        )}
      >
        <Upload className="size-6 text-lilac-ink" aria-hidden="true" />
        <div>
          <p className="text-[15px] font-semibold text-text">
            <span className="sm:hidden">Sumá fotos, PDF o documentos</span>
            <span className="hidden sm:inline">Arrastrá archivos acá o elegilos desde tu computadora</span>
          </p>
          <p id={hintId} className="mt-1 text-[13px] leading-5 text-text-3">
            PDF (sin límite de páginas), Word (.docx), texto, fotos (JPG, PNG, WEBP) o audios (MP3, M4A, WAV, OGG). Hasta 60 MB cada uno.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => pick(e.target.files)}
        />
        <Button variant="secondary" icon={<Upload className="size-4" />} aria-describedby={hintId} disabled={remaining <= 0}
          onClick={() => {
            replacing.current = null;
            inputRef.current?.click();
          }}
        >
          Elegir archivos
        </Button>
        <p className="text-xs text-text-3 tabular">
          {usable} de {MAX_FILES_PER_ACTIVITY} archivos
          {failed ? ` · ${plural(failed, "no se pudo leer y no cuenta", "no se pudieron leer y no cuentan")}` : ""}
        </p>
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {uploads.length ? (
        <ul className="mt-3 space-y-2" aria-label="Archivos que se están subiendo">
          {uploads.map((u) => (
            <li key={u.key} className={cn("rounded-md border px-3.5 py-3", u.error ? "border-rose/30 bg-rose-soft/50" : "border-line bg-surface")}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text">{u.name}</p>
                  {u.error ? (
                    <p role="alert" className="mt-0.5 text-[13px] leading-5 text-rose">
                      {u.error}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[13px] text-text-3">
                      {u.progress >= 1 ? "Guardando…" : u.progress > 0 ? `Subiendo… ${Math.round(u.progress * 100)}%` : "En espera para subir"} · {formatBytes(u.size)}
                    </p>
                  )}
                </div>
                {u.error ? (
                  <Button variant="ghost" size="icon" aria-label={`Quitar el aviso de ${u.name}`} onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
              {u.error ? null : (
                <div className="mt-2">
                  <ProgressBar value={u.progress} label={`Subida de ${u.name}`} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3">
        {files.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label="Cargando archivos">
            <Skeleton className="h-14 w-full" />
          </div>
        ) : files.isError ? (
          <ErrorState error={files.error} onRetry={() => void files.refetch()} />
        ) : list.length ? (
          <ul className="space-y-2" aria-label="Archivos de la actividad">
            {list.map((f) => (
              <FileRow
                key={f.id}
                activityId={activityId}
                file={f}
                long={long}
                onReplace={() => {
                  replacing.current = f.id;
                  inputRef.current?.click();
                }}
              />
            ))}
          </ul>
        ) : null}
      </div>
      {long ? (
        <p className="mt-3 rounded-md bg-sunken px-3.5 py-2.5 text-[13px] leading-5 text-text-2">
          El material de esta actividad es muy largo para leerlo entero en cada respuesta. Se usa todo: en cada momento de la charla el tutor recibe las partes
          que más se relacionan con lo que está conversando el alumno.
        </p>
      ) : null}
    </div>
  );
}

function statusLine(f: ActivityFile, long: boolean): string | null {
  if (f.processingStatus !== "ready") return null;
  if (f.kind === "audio") return "El tutor no puede escuchar audios. Escribí abajo una transcripción o un resumen para que lo use.";
  if (f.textChars === 0) return "No encontramos texto en este archivo: el tutor no puede usarlo.";
  const use = long ? "el tutor usa las partes que se relacionan con cada conversación" : "el tutor usa el documento completo";
  if (f.kind === "pdf" && f.pageCount) return `PDF de ${plural(f.pageCount, "página", "páginas")}: ${use}.`;
  return `Listo: ${use}.`;
}

function FileRow({ activityId, file: f, long, onReplace }: { activityId: string; file: ActivityFile; long: boolean; onReplace: () => void }) {
  const m = useFileMutations(activityId);
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState(false);
  const Icon = ICON[f.kind] ?? FileText;
  const busy = f.processingStatus === "pending" || f.processingStatus === "processing";
  const stuck = busy && Date.now() - new Date(f.updatedAt).getTime() > STUCK_MS;
  const line = statusLine(f, long);
  // Notes from the reader (e.g. "PDF escaneado…"); for audio the line above already explains it.
  const readerNote = f.processingStatus === "ready" && f.kind !== "audio" ? f.processingError : null;

  const retry = () =>
    m.retry.mutate(f.id, {
      onSuccess: () => toast.success(`Volvimos a leer "${f.fileName}"`),
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <li className="rounded-md border border-line bg-surface px-3.5 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-sunken text-ink">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 truncate text-sm font-semibold text-text">{f.fileName}</p>
            {f.processingStatus === "ready" ? null : (
              <Badge tone={f.processingStatus === "failed" ? "rose" : "ink"}>
                {busy ? <Spinner className="size-3" /> : <AlertTriangle className="size-3" aria-hidden="true" />}
                {PROCESSING_LABEL[f.processingStatus]}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-text-3">
            {formatBytes(f.sizeBytes)} · subido {fmtRelative(f.createdAt)}
          </p>
          {line ? <p className="mt-1 text-[13px] leading-5 text-text-2">{line}</p> : null}
          {readerNote ? <p className="mt-1 text-[13px] leading-5 text-text-3">{readerNote}</p> : null}
          {f.processingStatus === "failed" ? (
            <div className="mt-2 grid gap-2">
              <p role="alert" className="text-[13px] leading-5 text-rose">
                {f.processingError ?? "No se pudo leer el archivo."}
              </p>
              <p className="text-[13px] leading-5 text-text-2">El tutor no lo usa y no cuenta en el límite de archivos.</p>
              <div className="flex flex-wrap gap-2">
                {/* Reading a damaged or protected file again cannot work: offer only what can (D35). */}
                {f.retryable ? (
                  <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} loading={m.retry.isPending} onClick={retry}>
                    Reintentar
                  </Button>
                ) : null}
                {/* whitespace-normal: at 320 px the file column is narrower than the label. */}
                <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} onClick={onReplace} className="h-auto min-h-9 py-1.5 text-left whitespace-normal">
                  Subir otra versión
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setRemoving(true)}>
                  Quitar
                </Button>
              </div>
            </div>
          ) : stuck ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="text-[13px] leading-5 text-text-2">Está tardando más de lo normal.</p>
              <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} loading={m.retry.isPending} onClick={retry} className="self-start">
                Volver a intentar
              </Button>
            </div>
          ) : null}
        </div>
        <Menu
          trigger={
            <Button variant="ghost" size="icon" aria-label={`Opciones de ${f.fileName}`} className="-mr-1.5 shrink-0">
              <MoreHorizontal className="size-5" />
            </Button>
          }
          items={[
            ...(f.textChars > 0 ? [{ label: "Ver el texto que lee el tutor", icon: <ScrollText className="size-4" />, onSelect: () => setPreview(true) }] : []),
            {
              label: "Descargar",
              icon: <Download className="size-4" />,
              onSelect: () => {
                const a = document.createElement("a");
                a.href = fileDownloadUrl(activityId, f.id);
                a.download = f.fileName;
                document.body.appendChild(a);
                a.click();
                a.remove();
              },
            },
            "separator",
            { label: "Quitar archivo", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setRemoving(true) },
          ]}
        />
      </div>
      {f.kind === "audio" ? <AudioNote activityId={activityId} file={f} /> : null}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`¿Quitar "${f.fileName}"?`}
        description={<p>El archivo se borra de la actividad y el tutor deja de usarlo. No se puede deshacer.</p>}
        confirmLabel="Quitar archivo"
        loading={m.remove.isPending}
        onConfirm={() =>
          m.remove.mutate(f.id, {
            onSuccess: () => {
              toast.success("Archivo quitado");
              setRemoving(false);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
      {preview ? <TextPreview activityId={activityId} file={f} onClose={() => setPreview(false)} /> : null}
    </li>
  );
}

function AudioNote({ activityId, file }: { activityId: string; file: ActivityFile }) {
  const m = useFileMutations(activityId);
  const [note, setNote] = useState(file.teacherNote);
  useEffect(() => setNote(file.teacherNote), [file.teacherNote]);
  const changed = note.trim() !== file.teacherNote.trim();
  return (
    <div className="mt-3 border-t border-line pt-3">
      <Field
        label="Transcripción o resumen del audio"
        hint="Es lo que el tutor puede usar de este audio. Se guarda aparte, con su propio botón."
        counter={{ value: note.length, max: ACTIVITY_LIMITS.teacherNote }}
        error={m.note.error ? errorMessage(m.note.error) : undefined}
      >
        {(p) => (
          <Textarea id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={note} onChange={(e) => setNote(e.target.value)} minRows={2} maxRows={10} />
        )}
      </Field>
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          disabled={!changed || note.length > ACTIVITY_LIMITS.teacherNote}
          loading={m.note.isPending}
          onClick={() =>
            m.note.mutate({ fileId: file.id, teacherNote: note }, { onSuccess: () => toast.success("Nota guardada"), onError: (e) => toast.error(errorMessage(e)) })
          }
        >
          Guardar nota
        </Button>
      </div>
    </div>
  );
}

function TextPreview({ activityId, file, onClose }: { activityId: string; file: ActivityFile; onClose: () => void }) {
  const [text, setText] = useState("");
  const [next, setNext] = useState<number | null>(0);
  const [total, setTotal] = useState(file.textChars);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function load(offset: number) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchFileText(activityId, file.id, offset);
      setText((t) => (offset === 0 ? r.text : t + r.text));
      setNext(r.nextOffset);
      setTotal(r.total);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title="Texto que lee el tutor"
      description={`${file.fileName} · ${total.toLocaleString("es-AR")} caracteres${file.pageCount ? ` · ${plural(file.pageCount, "página", "páginas")}` : ""}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => void load(text ? (next ?? 0) : 0)} />
      ) : (
        <>
          {text ? <pre className="font-sans text-sm leading-6 whitespace-pre-wrap break-words text-text">{text}</pre> : null}
          {loading ? (
            <div className="py-4">
              <Spinner label="Cargando texto…" />
            </div>
          ) : next !== null ? (
            <div className="mt-4 flex flex-col items-center gap-1">
              <Button variant="secondary" onClick={() => void load(next)}>
                Mostrar más
              </Button>
              <p className="text-xs text-text-3 tabular">
                {Math.round((next / Math.max(1, total)) * 100)}% mostrado
              </p>
            </div>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
