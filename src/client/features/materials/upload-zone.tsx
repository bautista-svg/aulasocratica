import { useCallback, useId, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, CircleAlert, FileUp, X } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Spinner } from "@client/components/ui/spinner";
import { cn } from "@client/lib/cn";
import { errorMessage } from "@client/lib/api";
import { DOC_ACCEPT, FILE_ACCEPT, formatBytes, validateUpload } from "@shared/domain/files";
import type { MaterialSummary } from "@shared/contracts/materials";
import { materialKeys, uploadMaterialFile } from "./api";
import { prepareImage } from "./prepare-image";

type ItemStatus = "waiting" | "preparing" | "uploading" | "done" | "error";
interface Item {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: ItemStatus;
  error?: string;
}

let seq = 0;

/**
 * Drag & drop + file picker (+ camera on phones). Files go to "Mis materiales" one by one with
 * progress; photos are downsized in the browser first. Each uploaded material is reported to
 * `onUploaded` (the wizard uses it to select the file).
 */
export function UploadZone({
  onUploaded,
  allowAudio = true,
  maxFiles,
  compact,
  className,
}: {
  onUploaded?: (m: MaterialSummary) => void;
  allowAudio?: boolean;
  /** How many more files can be added (wizard: up to 10 materials). */
  maxFiles?: number;
  compact?: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const queue = useRef<{ key: string; file: File }[]>([]);
  const running = useRef(false);
  const hintId = useId();
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length) {
        const { key, file } = queue.current.shift()!;
        try {
          patch(key, { status: "preparing" });
          const ready = file.type.startsWith("image/") ? await prepareImage(file) : file;
          patch(key, { status: "uploading", size: ready.size });
          const res = await uploadMaterialFile(ready, {}, (f) => patch(key, { progress: f }));
          const rejected = res.rejected[0];
          if (rejected) patch(key, { status: "error", error: rejected.message });
          else patch(key, { status: "done", progress: 1 });
          for (const mat of res.materials) onUploadedRef.current?.(mat);
          void qc.invalidateQueries({ queryKey: materialKeys.all });
          setTimeout(() => setItems((list) => list.filter((it) => !(it.key === key && it.status === "done"))), 3000);
        } catch (err) {
          patch(key, { status: "error", error: errorMessage(err) || "No se pudo subir el archivo." });
        }
      }
    } finally {
      running.current = false;
    }
  }, [qc]);

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    let list = Array.from(files);
    const extra: Item[] = [];
    if (maxFiles !== undefined && list.length > maxFiles) {
      extra.push({
        key: `k${++seq}`,
        name: `${list.length - maxFiles} archivo(s) sin subir`,
        size: 0,
        progress: 0,
        status: "error",
        error: maxFiles > 0 ? `Podés sumar ${maxFiles} archivo(s) más.` : "Ya elegiste el máximo de materiales.",
      });
      list = list.slice(0, Math.max(0, maxFiles));
    }
    for (const file of list) {
      const key = `k${++seq}`;
      const check = validateUpload({ name: file.name, type: file.type, size: file.size }, { allowAudio });
      if (!check.ok) {
        extra.push({ key, name: file.name, size: file.size, progress: 0, status: "error", error: check.error });
        continue;
      }
      extra.push({ key, name: file.name, size: file.size, progress: 0, status: "waiting" });
      queue.current.push({ key, file });
    }
    setItems((cur) => [...cur, ...extra]);
    void run();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };

  const busy = items.some((i) => i.status === "waiting" || i.status === "preparing" || i.status === "uploading");

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center rounded-lg border-2 border-dashed px-5 text-center transition-colors",
          compact ? "py-5" : "py-8",
          over ? "border-lilac-ink bg-lilac-soft/60" : "border-line-strong bg-surface/70",
        )}
      >
        <FileUp className="mb-2 size-7 text-lilac-ink" aria-hidden="true" />
        <p className="font-semibold text-text">
          <span className="hidden sm:inline">Arrastrá archivos acá o elegilos</span>
          <span className="sm:hidden">Subí archivos o sacá una foto</span>
        </p>
        <p id={hintId} className="mt-1 max-w-md text-[13px] leading-5 text-text-3">
          PDF (sin límite de páginas), Word (.docx), fotos (JPG, PNG, WEBP){allowAudio ? ", audios" : ""} y archivos de texto. Hasta 60 MB por archivo.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()} aria-describedby={hintId} disabled={maxFiles === 0}>
            Elegir archivos
          </Button>
          <Button variant="secondary" className="sm:hidden" icon={<Camera className="size-4" />} onClick={() => cameraRef.current?.click()} disabled={maxFiles === 0}>
            Sacar una foto
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={allowAudio ? FILE_ACCEPT : DOC_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <ul aria-live="polite" aria-busy={busy || undefined} className={cn("grid gap-2", items.length && "mt-3")}>
        {items.map((it) => (
          <li key={it.key} className={cn("rounded-md border px-3.5 py-2.5", it.status === "error" ? "border-rose/30 bg-rose-soft/50" : "border-line bg-surface")}>
            <div className="flex items-center gap-3">
              <span className="shrink-0" aria-hidden="true">
                {it.status === "done" ? (
                  <CheckCircle2 className="size-5 text-leaf" />
                ) : it.status === "error" ? (
                  <CircleAlert className="size-5 text-rose" />
                ) : (
                  <Spinner className="size-5 text-ink" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text">{it.name}</p>
                <p className="text-[13px] text-text-2">
                  {it.status === "waiting" && "En espera…"}
                  {it.status === "preparing" && "Preparando…"}
                  {it.status === "uploading" && `Subiendo… ${Math.round(it.progress * 100)}%${it.size ? ` de ${formatBytes(it.size)}` : ""}`}
                  {it.status === "done" && "Subido. Ahora se lee en segundo plano."}
                  {it.status === "error" && <span className="font-medium text-rose">{it.error}</span>}
                </p>
              </div>
              {it.status === "error" ? (
                <Button variant="ghost" size="icon" aria-label={`Quitar aviso de ${it.name}`} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
            {it.status === "uploading" ? (
              <div
                role="progressbar"
                aria-label={`Subida de ${it.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(it.progress * 100)}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"
              >
                <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${Math.round(it.progress * 100)}%` }} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
