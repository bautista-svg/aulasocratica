import { File, FileAudio, FileImage, FileText, Link2, NotebookPen, type LucideIcon } from "lucide-react";
import { Badge } from "@client/components/ui/misc";
import { Spinner } from "@client/components/ui/spinner";
import { cn } from "@client/lib/cn";
import { KIND_LABEL, PROCESSING_LABEL, formatBytes, type FileKind } from "@shared/domain/files";
import type { MaterialSummary } from "@shared/contracts/materials";

const FILE_ICONS: Record<FileKind, LucideIcon> = { pdf: FileText, docx: FileText, text: FileText, image: FileImage, audio: FileAudio };

export function MaterialIcon({ material: m, className }: { material: Pick<MaterialSummary, "kind" | "fileKind">; className?: string }) {
  const Icon = m.kind === "link" ? Link2 : m.kind === "text" ? NotebookPen : m.fileKind ? FILE_ICONS[m.fileKind] : File;
  const tone = m.kind === "link" ? "bg-ink-soft text-ink" : m.kind === "text" ? "bg-leaf-soft text-leaf" : "bg-lilac-soft text-lilac-ink";
  return (
    <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-md", tone, className)}>
      <Icon className="size-5" />
    </span>
  );
}

const nf = new Intl.NumberFormat("es-AR");

export function materialMeta(m: MaterialSummary): string {
  if (m.kind === "link") {
    try {
      return `Enlace · ${new URL(m.url ?? "").hostname}`;
    } catch {
      return "Enlace";
    }
  }
  if (m.kind === "text") return `Texto · ${nf.format(m.textChars)} caracteres`;
  const parts: string[] = [m.fileKind ? KIND_LABEL[m.fileKind] : "Archivo"];
  if (m.pageCount) parts.push(m.pageCount === 1 ? "1 página" : `${nf.format(m.pageCount)} páginas`);
  if (m.sizeBytes) parts.push(formatBytes(m.sizeBytes));
  return parts.join(" · ");
}

/** Reading status of a file. Ready files show nothing unless there is a note. */
export function MaterialStatus({ material: m, showReady }: { material: MaterialSummary; showReady?: boolean }) {
  if (m.kind !== "file") return null;
  if (m.processingStatus === "pending" || m.processingStatus === "processing") {
    return (
      <Badge tone="ink">
        <Spinner className="size-3" />
        {PROCESSING_LABEL[m.processingStatus]}
      </Badge>
    );
  }
  if (m.processingStatus === "failed") return <Badge tone="rose">{PROCESSING_LABEL.failed}</Badge>;
  if (m.fileKind === "audio" && m.textChars === 0) return <Badge tone="amber">Sin transcripción</Badge>;
  return showReady ? <Badge tone="leaf">Listo</Badge> : null;
}
