// "Pedidos de cambios" in the admin panel: what teachers sent, with the conversation and the
// screenshots, to mark in progress / done with a note they read in the app.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, MessageSquarePlus } from "lucide-react";
import { Card, CardHeader, ErrorState, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Field, Input, Select, Textarea } from "@client/components/ui/field";
import { api, errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import { fmtDateTime } from "@client/lib/format";
import { StatusBadge } from "@client/features/requests/bits";
import { REQUEST_KIND_LABELS, REQUEST_STATUS_LABELS, type AdminChangeRequest, type RequestStatus } from "@shared/contracts/requests";
import { adminKeys } from "./api";

const key = (all: boolean) => [...adminKeys.all, "requests", all ? "all" : "open"] as const;
const STATUSES: Exclude<RequestStatus, "draft">[] = ["pending", "in_progress", "done", "discarded"];

function RequestItem({ r }: { r: AdminChangeRequest }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(r.status as Exclude<RequestStatus, "draft">);
  const [note, setNote] = useState(r.note);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/admin/requests/${r.id}`, { status, note }),
    onSuccess: () => {
      toast.success("Pedido actualizado");
      void qc.invalidateQueries({ queryKey: [...adminKeys.all, "requests"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = r.summary;
  const images = new Map(r.images.map((i) => [i.id, i]));
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-sunken/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lilac-ink"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            {s ? <span className="text-xs font-semibold text-text-3">{REQUEST_KIND_LABELS[s.kind]}</span> : null}
            {!r.ready ? <span className="text-xs text-amber">la IA tenía preguntas</span> : null}
          </div>
          <p className="mt-1 font-semibold text-ink">{r.title || "(sin título)"}</p>
          <p className="text-xs text-text-3">
            {r.teacher.name || "Sin nombre"} · {r.teacher.email ?? "sin correo"} · {fmtDateTime(r.submittedAt)}
          </p>
        </div>
        <ChevronDown className={cn("mt-1 size-5 shrink-0 text-text-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div className="grid gap-5 px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4 text-sm leading-6">
            {s ? (
              <dl className="grid gap-2 rounded-md bg-sunken/60 px-4 py-3">
                {s.screen ? (
                  <div>
                    <dt className="text-xs font-semibold text-text-3">Dónde</dt>
                    <dd>{s.screen}</dd>
                  </div>
                ) : null}
                {s.today ? (
                  <div>
                    <dt className="text-xs font-semibold text-text-3">Hoy</dt>
                    <dd>{s.today}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs font-semibold text-text-3">Quiere</dt>
                  <dd>{s.desired}</dd>
                </div>
                {s.details.length ? (
                  <div>
                    <dt className="text-xs font-semibold text-text-3">Detalles</dt>
                    <dd>
                      <ul className="list-disc pl-5">
                        {s.details.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <details className="rounded-md border border-line px-4 py-2">
              <summary className="cursor-pointer py-1 font-semibold text-text-2">Conversación ({r.messages.length} mensajes)</summary>
              <ol className="mt-2 space-y-2">
                {r.messages.map((m, i) => (
                  <li key={i}>
                    <span className={cn("font-semibold", m.role === "teacher" ? "text-ink" : "text-lilac-ink")}>
                      {m.role === "teacher" ? "Docente" : "IA"}:
                    </span>{" "}
                    <span className="whitespace-pre-wrap">{m.text}</span>
                    {m.imageIds.length ? (
                      <span className="mt-1 flex flex-wrap gap-2">
                        {m.imageIds.map((id) => {
                          const img = images.get(id);
                          return img ? (
                            <a key={id} href={img.url} target="_blank" rel="noreferrer">
                              <img src={img.url} alt={`Captura: ${img.name}`} className="h-24 rounded-sm border border-line object-cover" />
                            </a>
                          ) : null;
                        })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </details>
          </div>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Estado">
              {(p) => (
                <Select id={p.id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  {STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {REQUEST_STATUS_LABELS[st]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Nota para la docente" optional hint="La ve en el pedido: qué se hizo o por qué no.">
              {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} value={note} maxLength={4000} minRows={3} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <Button type="submit" size="sm" loading={save.isPending}>
              Guardar
            </Button>
          </form>
        </div>
      ) : null}
    </li>
  );
}

function AccessForm() {
  const [email, setEmail] = useState("");
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.post<{ teacher: { email: string; enabled: boolean } }>("/api/admin/requests-access", { email, enabled }),
    onSuccess: (d) => {
      toast.success(`${d.teacher.enabled ? "Habilitado" : "Deshabilitado"} para ${d.teacher.email}`);
      setEmail("");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form className="flex flex-col gap-2 border-t border-line px-5 py-4 sm:flex-row sm:items-end" onSubmit={(e) => e.preventDefault()}>
      <Field label="Habilitar la sección para una cuenta" className="flex-1">
        {(p) => <Input id={p.id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@escuela.edu.ar" />}
      </Field>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" disabled={!email.trim()} loading={toggle.isPending && toggle.variables} onClick={() => toggle.mutate(true)}>
          Habilitar
        </Button>
        <Button type="button" variant="ghost" disabled={!email.trim()} loading={toggle.isPending && !toggle.variables} onClick={() => toggle.mutate(false)}>
          Quitar
        </Button>
      </div>
    </form>
  );
}

export function RequestsPanel() {
  const [all, setAll] = useState(false);
  const q = useQuery({
    queryKey: key(all),
    queryFn: ({ signal }) => api.get<{ requests: AdminChangeRequest[] }>(`/api/admin/requests${all ? "?status=all" : ""}`, signal),
    select: (d) => d.requests,
    refetchInterval: 60_000,
  });
  return (
    <Card>
      <CardHeader
        title="Pedidos de cambios"
        description="Lo que las docentes con la sección habilitada enviaron al equipo."
        action={
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? "Solo abiertos" : "Ver todos"}
          </Button>
        }
      />
      {q.isPending ? (
        <div className="p-5">
          <SkeletonList rows={2} />
        </div>
      ) : q.isError ? (
        <div className="p-5">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : q.data.length === 0 ? (
        <p className="flex items-center gap-2 px-5 pt-3 pb-5 text-sm text-text-3">
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          {all ? "Todavía no hay pedidos." : "No hay pedidos abiertos."}
        </p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {q.data.map((r) => (
            <RequestItem key={`${r.id}-${r.status}-${r.note}`} r={r} />
          ))}
        </ul>
      )}
      <AccessForm />
    </Card>
  );
}
