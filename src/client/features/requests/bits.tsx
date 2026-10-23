import type { ReactNode } from "react";
import { Check, CheckCircle2, MapPin, MessageSquareText, Sparkles } from "lucide-react";
import { Badge, type Tone } from "@client/components/ui/misc";
import { cn } from "@client/lib/cn";
import { fmtDate } from "@client/lib/format";
import {
  REQUEST_KIND_LABELS,
  REQUEST_STATUS_LABELS,
  type ChangeRequestView,
  type RequestStatus,
} from "@shared/contracts/requests";

const STATUS_TONE: Record<RequestStatus, Tone> = {
  draft: "neutral",
  pending: "lilac",
  in_progress: "amber",
  done: "leaf",
  discarded: "neutral",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}

/** What the team answered (what was done, or why not). */
export function TeamNote({ request, className }: { request: ChangeRequestView; className?: string }) {
  if (!request.note) return null;
  const done = request.status === "done";
  return (
    <div className={cn("flex gap-3 rounded-[14px] px-4 py-3", done ? "bg-leaf-soft" : "bg-sunken", className)}>
      {done ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-leaf" aria-hidden="true" />
      ) : (
        <MessageSquareText className="mt-0.5 size-5 shrink-0 text-text-2" aria-hidden="true" />
      )}
      <div className="min-w-0 text-sm leading-6">
        <p className={cn("font-semibold", done ? "text-leaf" : "text-text")}>Respuesta del equipo</p>
        <p className="whitespace-pre-wrap text-text">{request.note}</p>
      </div>
    </div>
  );
}

function Row({ icon, label, children, empty }: { icon?: ReactNode; label: string; children: ReactNode; empty: boolean }) {
  return (
    <div className="grid gap-1 border-t border-dashed border-line py-3 first:border-t-0 first:pt-0">
      <dt className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-text-3 uppercase">
        {icon}
        {label}
      </dt>
      <dd className={cn("text-[15px] leading-6", empty ? "text-text-3 italic" : "text-text")}>{children}</dd>
    </div>
  );
}

/**
 * "Lo que entendí": the request as the AI understands it so far. It fills in while she talks,
 * and it is what she confirms before sending.
 */
export function SummaryCard({ request, footer }: { request: ChangeRequestView; footer?: ReactNode }) {
  const s = request.summary;
  const ready = request.ready && request.status === "draft";
  return (
    <section
      aria-labelledby="resumen-pedido"
      className={cn(
        "relative overflow-hidden rounded-[20px] border bg-surface shadow-2 transition-colors",
        ready ? "border-leaf/40" : "border-line",
      )}
    >
      {/* The tab on top makes it read as a filed card. */}
      <div className={cn("flex items-center justify-between gap-3 px-5 py-3", ready ? "bg-leaf-soft" : "bg-lilac-soft/70")}>
        <h2 id="resumen-pedido" className={cn("flex items-center gap-2 text-sm font-semibold", ready ? "text-leaf" : "text-lilac-ink")}>
          {ready ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
          {ready ? "Listo para enviar" : "Lo que entendí hasta ahora"}
        </h2>
        {s ? <span className="text-xs font-semibold text-text-2">{REQUEST_KIND_LABELS[s.kind]}</span> : null}
      </div>
      <div className="px-5 pt-4 pb-5">
        <p className={cn("font-display text-[21px] leading-snug font-semibold text-balance", s ? "text-ink" : "text-text-3")}>
          {s?.title || "Tu pedido"}
        </p>
        <dl className="mt-4">
          <Row icon={<MapPin className="size-3.5" aria-hidden="true" />} label="Dónde" empty={!s?.screen}>
            {s?.screen || "Todavía no lo sé."}
          </Row>
          {s?.kind !== "new" ? (
            <Row label="Cómo es hoy" empty={!s?.today}>
              {s?.today || "Todavía no lo sé."}
            </Row>
          ) : null}
          <Row label="Lo que querés" empty={!s?.desired}>
            {s?.desired || "Contame qué te gustaría y lo voy anotando acá."}
          </Row>
          {s?.details.length ? (
            <Row label="Detalles" empty={false}>
              <ul className="mt-1 space-y-1.5">
                {s.details.map((d, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-leaf" aria-hidden="true">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
        </dl>
        {request.submittedAt ? <p className="mt-3 text-xs text-text-3">Enviado el {fmtDate(request.submittedAt)}</p> : null}
        {footer ? <div className="mt-5">{footer}</div> : null}
      </div>
    </section>
  );
}
