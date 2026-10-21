import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Download, MoreHorizontal, Pencil, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { Badge, ErrorState, Notice, PageHeader } from "@client/components/ui/misc";
import { Button, buttonClass } from "@client/components/ui/button";
import { Menu } from "@client/components/ui/controls";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Field, Input } from "@client/components/ui/field";
import { PageSpinner, Spinner } from "@client/components/ui/spinner";
import { ApiError, errorMessage } from "@client/lib/api";
import { fmtDateTime } from "@client/lib/format";
import { useReport, useReportMutations } from "@client/features/reports/api";
import { ReportDataView, SourceTag } from "@client/features/reports/report-data-view";
import { NarrativeEditor } from "@client/features/reports/narrative-editor";
import { LeaveGuard } from "@client/features/account/leave-guard";
import { usePageTitle } from "@client/lib/page-title";
import { focusFirstInvalid } from "@client/lib/forms";
import { REPORT_KIND_LABELS, REPORT_SECTIONS, missingSections } from "@shared/domain/reports";
import type { ReportDetail } from "@shared/contracts/reports";

export const Route = createFileRoute("/app/informes/$reportId")({
  component: ReportPage,
});

function ReportPage() {
  const { reportId } = Route.useParams();
  const q = useReport(reportId);
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  usePageTitle(notFound ? ["Informe no encontrado", "Informes"] : q.isError ? "Informes" : [q.data?.title ?? "Informe", "Informes"]);
  if (q.isPending) return <PageSpinner />;
  if (q.isError) {
    // A missing report gets its own way out inside ErrorState ("Volver a Informes", no "Reintentar").
    return (
      <div className="grid gap-4">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        {notFound ? null : (
          <Link to="/app/informes" className={buttonClass("secondary", "md", "justify-self-center")}>
            Volver a Informes
          </Link>
        )}
      </div>
    );
  }
  return <ReportScreen key={q.data.id} report={q.data} />;
}

const same = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a) === JSON.stringify(b);

function ReportScreen({ report }: { report: ReportDetail }) {
  const m = useReportMutations(report.id);
  const navigate = useNavigate();
  const sections = REPORT_SECTIONS[report.kind];
  const [text, setText] = useState<Record<string, string>>(report.narrative);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [suggestion, setSuggestion] = useState<Record<string, string> | null>(null);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const dirty = !same(text, report.narrative);
  const busy = m.save.isPending || m.validate.isPending;

  const save = async (): Promise<boolean> => {
    try {
      await m.save.mutateAsync({ narrative: text });
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };

  const validate = async () => {
    // Same rule as the server, checked here first: mark every empty section and go to the first.
    const missing = missingSections(report.kind, text);
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((s) => [s.key, "Completá esta sección antes de validar."])));
      toast.error(missing.length === 1 ? `Completá «${missing[0]!.label}» antes de validar.` : "Completá las secciones marcadas antes de validar.");
      focusFirstInvalid(editorRef.current);
      return;
    }
    if (dirty && !(await save())) return;
    m.validate.mutate(undefined, {
      onSuccess: () => {
        setErrors({});
        toast.success("Informe validado");
      },
      onError: (e) => {
        if (e instanceof ApiError) setErrors(e.fields);
        toast.error(errorMessage(e));
        focusFirstInvalid(editorRef.current);
      },
    });
  };

  const download = (ext: "csv" | "pdf") => async (e: MouseEvent<HTMLAnchorElement>) => {
    if (!dirty) return; // plain link download
    e.preventDefault();
    if (await save()) window.location.assign(`/api/reports/${report.id}/export.${ext}`);
  };

  const refresh = () =>
    m.refresh.mutate(undefined, {
      onSuccess: () => {
        setConfirmRefresh(false);
        toast.success("Datos actualizados");
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <>
      <nav aria-label="Ruta" className="mb-3 text-sm text-text-3">
        <Link to="/app/informes" className="-my-3 inline-flex min-h-11 items-center hover:text-ink sm:my-0 sm:min-h-0">
          Informes
        </Link>
        <ChevronRight className="mx-1 inline size-3.5" aria-hidden="true" />
        <span className="text-text-2">{REPORT_KIND_LABELS[report.kind]}</span>
      </nav>
      <PageHeader
        eyebrow={`Informe ${REPORT_KIND_LABELS[report.kind].toLowerCase()}`}
        title={report.title}
        description={report.scopeLabel || undefined}
        actions={
          <>
            <a href={`/api/reports/${report.id}/export.pdf`} onClick={download("pdf")} className={buttonClass("secondary")} download>
              <Download className="size-4" aria-hidden="true" />
              Descargar PDF
            </a>
            <a href={`/api/reports/${report.id}/export.csv`} onClick={download("csv")} className={buttonClass("secondary")} download>
              <Download className="size-4" aria-hidden="true" />
              CSV
            </a>
            <Menu
              trigger={
                <Button variant="secondary" size="icon" aria-label="Más opciones del informe">
                  <MoreHorizontal className="size-5" />
                </Button>
              }
              items={[
                {
                  label: "Actualizar datos",
                  icon: <RefreshCw className="size-4" />,
                  onSelect: () => (report.status === "validated" ? setConfirmRefresh(true) : refresh()),
                  disabled: m.refresh.isPending,
                },
                { label: "Cambiar título", icon: <Pencil className="size-4" />, onSelect: () => setRenaming(true) },
                "separator",
                { label: "Eliminar informe", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </>
        }
      />

      <div aria-live="polite">
        {m.refresh.isPending ? (
          <p className="mb-4">
            <Spinner label="Actualizando los datos…" />
          </p>
        ) : null}
      </div>

      {report.status === "validated" ? (
        <Notice tone="leaf" className="mb-6" title={`Validado el ${fmtDateTime(report.validatedAt)}`}>
          Si cambiás el texto o actualizás los datos, el informe vuelve a borrador hasta que lo valides de nuevo.
        </Notice>
      ) : (
        <Notice tone="amber" className="mb-6" title="Borrador">
          Revisá los datos y completá la valoración antes de usarlo para tomar decisiones. Al validarlo queda registrado con fecha.
        </Notice>
      )}

      <div className="grid gap-10">
        <ReportDataView data={report.data} />

        <section aria-labelledby="valoracion" className="grid gap-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="valoracion" className="font-display text-xl font-semibold text-ink">
                  Valoración del docente
                </h2>
                <SourceTag source="teacher" />
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-text-2">
                Tu lectura de los datos. Podés pedirle a la IA una propuesta: aparece al lado de cada sección y solo entra en tu texto si la insertás.
              </p>
            </div>
            <Button
              variant="lilac"
              icon={<Sparkles className="size-4" />}
              loading={m.draft.isPending}
              onClick={() =>
                m.draft.mutate(undefined, {
                  onSuccess: (r) => {
                    setSuggestion(r.draft);
                    toast.success("La IA propuso un texto para cada sección", { description: "Revisalo e insertá lo que te sirva." });
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              {suggestion ? "Proponer otra vez con IA" : "Proponer con IA"}
            </Button>
          </div>
          <p className="sr-only" aria-live="polite">
            {m.draft.isPending ? "La IA está redactando una propuesta…" : suggestion ? "Hay propuestas de la IA debajo de cada sección." : ""}
          </p>
          {m.draft.isPending ? <Spinner label="La IA está leyendo los datos y redactando una propuesta…" /> : null}

          {/* The save bar sticks only while the editor is on screen (it never covers the section heading). */}
          <div ref={editorRef} className="grid gap-5">
            <NarrativeEditor
              sections={sections}
              text={text}
              errors={errors}
              suggestion={suggestion}
              disabled={busy}
              onChange={(key, value) => {
                setText((t) => ({ ...t, [key]: value }));
                if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
              }}
              onInsert={(key) => {
                const s = suggestion?.[key]?.trim() ?? "";
                setText((t) => ({ ...t, [key]: t[key]?.trim() ? `${t[key]!.trimEnd()}\n\n${s}` : s }));
                setSuggestion((all) => (all ? { ...all, [key]: "" } : all));
                if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
              }}
              onDiscard={(key) => setSuggestion((all) => (all ? { ...all, [key]: "" } : all))}
            />

            <div className="sticky bottom-20 z-10 flex items-center justify-end gap-2 rounded-lg border border-line bg-surface/95 p-2 shadow-2 backdrop-blur sm:p-3 lg:bottom-4">
              <p className="mr-auto hidden min-w-0 pl-1 text-[13px] leading-5 text-text-2 min-[360px]:block sm:text-sm" aria-live="polite">
                {dirty ? "Cambios sin guardar" : report.status === "validated" ? "Guardado y validado" : "Todo guardado"}
              </p>
              <Button
                variant="secondary"
                icon={<Save className="size-4" />}
                disabled={!dirty || busy}
                loading={m.save.isPending}
                onClick={async () => {
                  if (await save()) toast.success("Cambios guardados");
                }}
              >
                Guardar<span className="hidden sm:inline"> cambios</span>
              </Button>
              <Button
                icon={<CheckCircle2 className="size-4" />}
                loading={m.validate.isPending}
                disabled={busy || (report.status === "validated" && !dirty)}
                onClick={validate}
              >
                {report.status === "validated" && !dirty ? (
                  "Validado"
                ) : (
                  <>
                    Validar<span className="hidden sm:inline"> informe</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </section>

        <p className="text-sm text-text-3">
          Creado el {fmtDateTime(report.createdAt)}. <Badge className="ml-1">{report.status === "validated" ? "Validado" : "Borrador"}</Badge>
        </p>
      </div>

      <LeaveGuard when={dirty} description="Tenés cambios sin guardar en la valoración. Si salís ahora, se pierden." />

      <RenameDialog open={renaming} onOpenChange={setRenaming} report={report} />
      <ConfirmDialog
        open={confirmRefresh}
        onOpenChange={setConfirmRefresh}
        variant="primary"
        title="¿Actualizar los datos?"
        description={
          <p>
            Se vuelven a tomar los datos de las actividades. Tu texto se mantiene, pero el informe vuelve a borrador hasta que lo valides de nuevo.
          </p>
        }
        confirmLabel="Actualizar datos"
        loading={m.refresh.isPending}
        onConfirm={refresh}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Eliminar este informe?"
        description={
          <p>Se borra «{report.title}» con su valoración. Los datos de las actividades no se tocan: podés armar otro informe cuando quieras.</p>
        }
        confirmLabel="Eliminar informe"
        loading={m.remove.isPending}
        onConfirm={() =>
          m.remove.mutate(undefined, {
            onSuccess: () => {
              setText(report.narrative); // nothing left to protect: let the guard re-render first
              toast.success("Informe eliminado");
              setTimeout(() => void navigate({ to: "/app/informes" }), 0);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}

function RenameDialog({ open, onOpenChange, report }: { open: boolean; onOpenChange: (o: boolean) => void; report: ReportDetail }) {
  const [title, setTitle] = useState(report.title);
  const { save } = useReportMutations(report.id);
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  useEffect(() => {
    if (open) {
      setTitle(report.title);
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = () =>
    save.mutate(
      { title: title.trim() },
      {
        onSuccess: () => {
          toast.success("Título guardado");
          onOpenChange(false);
        },
      },
    );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cambiar título"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!title.trim() || title.trim() === report.title} onClick={submit}>
            Guardar título
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) submit();
        }}
      >
        <Field
          label="Título"
          error={fields.title ?? (save.isError && !fields.title ? errorMessage(save.error) : undefined)}
          hint={report.status === "validated" ? "Si cambiás el título, el informe vuelve a borrador." : undefined}
        >
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
