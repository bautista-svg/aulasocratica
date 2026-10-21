import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { ErrorState, Skeleton } from "@client/components/ui/misc";
import { PREVIEW_PAGE_CHARS } from "@shared/domain/library";
import type { MaterialSummary } from "@shared/contracts/materials";
import { useMaterialText } from "./api";

const nf = new Intl.NumberFormat("es-AR");

/** What the AI and the tutor read from a material, page by page (12 000 characters each). */
export function TextPreviewDialog({ material, onOpenChange }: { material: MaterialSummary | null; onOpenChange: (o: boolean) => void }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [material?.id]);
  const q = useMaterialText(material?.id ?? null, offset);
  const total = q.data?.total ?? material?.textChars ?? 0;
  const pages = Math.max(1, Math.ceil(total / PREVIEW_PAGE_CHARS));
  const current = Math.floor(offset / PREVIEW_PAGE_CHARS) + 1;

  return (
    <Dialog
      open={material !== null}
      onOpenChange={onOpenChange}
      wide
      title={material ? `Texto de «${material.title}»` : "Texto"}
      description={
        material
          ? `Esto es lo que leen la IA y el tutor: ${nf.format(total)} caracteres${material.pageCount ? ` de ${material.pageCount} ${material.pageCount === 1 ? "página" : "páginas"}` : ""}.${
              material.processingError && material.processingStatus === "ready" ? ` ${material.processingError}` : ""
            }`
          : undefined
      }
      footer={
        pages > 1 ? (
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="secondary" icon={<ChevronLeft className="size-4" />} disabled={current <= 1 || q.isFetching} onClick={() => setOffset(Math.max(0, offset - PREVIEW_PAGE_CHARS))}>
              Anterior
            </Button>
            <span className="tabular text-sm text-text-2" aria-live="polite">
              Parte {current} de {pages}
            </span>
            <Button variant="secondary" disabled={current >= pages || q.isFetching} onClick={() => setOffset(offset + PREVIEW_PAGE_CHARS)}>
              Siguiente
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : undefined
      }
    >
      {q.isPending ? (
        <div className="grid gap-2" aria-busy="true" aria-label="Cargando texto">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.text ? (
        <pre className="font-sans text-[15px] leading-7 whitespace-pre-wrap text-text">{q.data.text}</pre>
      ) : (
        <p className="text-text-2">Este material no tiene texto para leer.</p>
      )}
    </Dialog>
  );
}
