import { Download, ExternalLink, Eye, MoreHorizontal, Pencil, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Menu } from "@client/components/ui/controls";
import { errorMessage } from "@client/lib/api";
import { fmtRelative } from "@client/lib/format";
import type { MaterialSummary } from "@shared/contracts/materials";
import { isBusy, useMaterialMutations } from "./api";
import { MaterialIcon, MaterialStatus, materialMeta } from "./material-parts";

const STUCK_MS = 3 * 60_000;

export function MaterialRow({
  material: m,
  onPreview,
  onEdit,
  onDelete,
  onUse,
}: {
  material: MaterialSummary;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUse: () => void;
}) {
  const mut = useMaterialMutations();
  const busy = isBusy(m);
  const stuck = busy && Date.now() - new Date(m.updatedAt).getTime() > STUCK_MS;
  const canPreview = m.textChars > 0 && !busy;
  const retry = () =>
    mut.retry.mutate(m.id, {
      onSuccess: () => toast.success("Lo estamos leyendo de nuevo"),
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <article className="flex h-full gap-3 rounded-lg border border-line bg-surface p-4 shadow-1">
      <MaterialIcon material={m} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold break-words text-text">{m.title}</h3>
            <p className="mt-0.5 text-[13px] text-text-3">
              {materialMeta(m)}
              {m.folder ? ` · ${m.folder}` : ""}
              {" · "}
              {fmtRelative(m.updatedAt)}
            </p>
          </div>
          <Menu
            trigger={
              <Button variant="ghost" size="icon" className="-mt-1.5 -mr-1.5 shrink-0" aria-label={`Más opciones de ${m.title}`}>
                <MoreHorizontal className="size-5" />
              </Button>
            }
            items={[
              ...(canPreview ? [{ label: "Ver el texto que se leyó", icon: <Eye className="size-4" />, onSelect: onPreview }] : []),
              ...(m.kind === "file"
                ? [{ label: "Descargar el archivo", icon: <Download className="size-4" />, onSelect: () => (window.location.href = `/api/materials/${m.id}/download`) }]
                : []),
              ...(m.kind === "link" && m.url
                ? [{ label: "Abrir el enlace", icon: <ExternalLink className="size-4" />, onSelect: () => window.open(m.url!, "_blank", "noopener,noreferrer") }]
                : []),
              { label: "Editar", icon: <Pencil className="size-4" />, onSelect: onEdit },
              "separator" as const,
              { label: "Eliminar", icon: <Trash2 className="size-4" />, danger: true, onSelect: onDelete },
            ]}
          />
        </div>

        {(m.kind === "file" || m.tags.length) ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <MaterialStatus material={m} />
            {m.tags.map((t) => (
              <Badge key={t} tone="neutral">
                #{t}
              </Badge>
            ))}
          </div>
        ) : null}

        {m.processingStatus === "failed" ? (
          <p className="mt-2 text-[13px] leading-5 font-medium text-rose">{m.processingError ?? "No se pudo leer el archivo."}</p>
        ) : m.processingStatus === "ready" && m.kind === "file" && m.processingError ? (
          <p className="mt-2 text-[13px] leading-5 text-text-2">{m.processingError}</p>
        ) : busy ? (
          <p className="mt-2 text-[13px] leading-5 text-text-2">
            {stuck ? "Está tardando más de lo normal." : "Se está leyendo completo. Podés seguir trabajando."}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {m.processingStatus === "failed" || stuck ? (
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={mut.retry.isPending} onClick={retry}>
              Reintentar
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" icon={<Sparkles className="size-4" />} onClick={onUse} disabled={m.processingStatus === "failed"}>
            Usar en una actividad
          </Button>
          {canPreview ? (
            <Button size="sm" variant="ghost" icon={<Eye className="size-4" />} onClick={onPreview}>
              Ver texto
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
