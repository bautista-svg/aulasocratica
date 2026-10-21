import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { fmtDate, fmtRelative } from "@client/lib/format";
import { useReports } from "@client/features/reports/api";
import { NewReportDialog } from "@client/features/reports/new-report-dialog";
import { usePageTitle } from "@client/features/account/page-title";
import { REPORT_KIND_LABELS } from "@shared/domain/reports";

export const Route = createFileRoute("/app/informes/")({
  component: ReportsPage,
});

function ReportsPage() {
  usePageTitle("Informes");
  const q = useReports();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Informes"
        description="Informes con los datos observados en tus actividades. La IA puede proponer el texto; vos lo revisás, lo editás y lo validás."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nuevo informe
          </Button>
        }
      />

      {q.isPending ? (
        <SkeletonList rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8" />}
          title="Todavía no hiciste informes"
          description="Elegí un alumno, un aula o una actividad. El informe junta participación, ayudas pedidas y lo que confirmaste, y vos escribís la valoración."
          action={
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Crear mi primer informe
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-1">
          {q.data.map((r) => (
            <li key={r.id}>
              <Link
                to="/app/informes/$reportId"
                params={{ reportId: r.id }}
                className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-paper"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{r.title}</span>
                    {r.status === "validated" ? <Badge tone="leaf">Validado</Badge> : <Badge>Borrador</Badge>}
                  </span>
                  <span className="mt-1 block text-sm text-text-2">
                    {REPORT_KIND_LABELS[r.kind]}
                    {r.scopeLabel ? ` · ${r.scopeLabel}` : ""}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-3">
                    Creado el {fmtDate(r.createdAt)} · editado {fmtRelative(r.updatedAt)}
                  </span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-text-3" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewReportDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
