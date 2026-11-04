// The activity's section for «Defensa de código» (its tab takes the subject's name, like «Diseño web»):
// who loaded code, and fragment by fragment what each student could explain. It shows what they
// can explain, not who wrote the code, and it says so.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ClipboardPaste, Code2, ExternalLink, LogOut, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@client/components/ui/button";
import { CodeBlock } from "@client/components/ui/code-block";
import { Dialog } from "@client/components/ui/dialog";
import { Field, Input } from "@client/components/ui/field";
import { Badge, EmptyState, ErrorState, Notice, SkeletonList, type Tone } from "@client/components/ui/misc";
import { CodeInput, codeFilesToSend } from "@client/components/app/code-input";
import { errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import { plural } from "@client/lib/format";
import { roomColor, roomInitials } from "@client/lib/room-color";
import { useCan } from "@client/features/sharing/role";
import { renderInline } from "@client/features/student/markdown";
import { BAND_LABELS, QUESTION_KIND_LABELS, VERDICT_LABELS, type CodeFile, type DefenseBand, type DefenseVerdict } from "@shared/domain/code-defense";
import type { DefenseCheckView, DefenseStudentRow } from "@shared/contracts/code-defense";
import { useCodeDefense, useLoadStudentCode, useStudentCode } from "./api";

const BAND_TONE: Record<DefenseBand, Tone> = { explains: "leaf", partly: "amber", struggles: "rose", pending: "neutral" };
const VERDICT_TONE: Record<DefenseVerdict, Tone> = { explained: "leaf", partial: "amber", not_explained: "rose" };
const VERDICT_TILE: Record<DefenseVerdict, string> = { explained: "bg-leaf", partial: "bg-amber", not_explained: "bg-rose" };

export function CodeDefensePanel({ activityId, title }: { activityId: string; title: string }) {
  const q = useCodeDefense(activityId);
  const canEdit = useCan("edit");
  const [loading, setLoading] = useState(false);

  if (q.isPending) return <SkeletonList rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { students, sharedCode } = q.data;
  const count = (b: DefenseBand) => students.filter((s) => s.band === b).length;

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
          <p className="mt-1 text-[14px] leading-6 text-text-2">
            El tutor le muestra a cada alumno partes de su propio código y le pregunta qué significan, qué hacen y qué pasaría si cambiaran. Acá ves qué pudo explicar.
          </p>
        </div>
        {canEdit ? (
          <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setLoading(true)}>
            Cargar código de un alumno
          </Button>
        ) : null}
      </header>

      {students.length === 0 ? (
        <EmptyState
          level={3}
          icon={<Code2 className="size-8" aria-hidden="true" />}
          title="Todavía no hay código"
          description={
            sharedCode
              ? "Cuando entren tus alumnos, el tutor les va a preguntar por el código que cargaste en Material."
              : "Cada alumno sube su código al entrar con el enlace. Si no lo tiene a mano, cargalo vos desde acá."
          }
        />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {(["explains", "partly", "struggles"] as const).map((b) => (
              <div key={b} className="rounded-lg border border-line bg-surface px-3 py-3 shadow-1 sm:px-4">
                <dd className={cn("text-[24px] leading-none font-semibold tabular", b === "explains" ? "text-leaf" : b === "partly" ? "text-amber" : "text-rose")}>{count(b)}</dd>
                <dt className="mt-1.5 text-[12.5px] leading-4 text-text-2">{BAND_LABELS[b]}</dt>
              </div>
            ))}
          </dl>

          <Notice tone="ink" title="Es una señal, no una prueba">
            Muestra cuánto puede explicar cada alumno, no quién escribió el código. Si a alguien le cuesta, conviene hablarlo en persona antes de sacar conclusiones.
          </Notice>

          <ul className="grid gap-2.5">
            {students.map((s) => (
              <StudentRow key={s.studentId} activityId={activityId} student={s} />
            ))}
          </ul>
        </>
      )}

      {loading ? <LoadCodeDialog activityId={activityId} onClose={() => setLoading(false)} /> : null}
    </div>
  );
}

function FragmentStrip({ checks }: { checks: DefenseCheckView[] }) {
  if (!checks.length) return null;
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {checks.map((c) => (
        <span key={c.id} className={cn("h-2.5 w-4 rounded-full", c.verdict ? VERDICT_TILE[c.verdict] : "bg-line-strong")} />
      ))}
    </span>
  );
}

const statusLine = (s: DefenseStudentRow) => {
  if (s.status === "waiting") return "Su código está cargado. Todavía no entró.";
  if (!s.checks.length) return "Entró, todavía sin preguntas.";
  const parts = `${s.explained} de ${s.answered} ${s.answered === 1 ? "fragmento explicado" : "fragmentos explicados"}`;
  return s.status === "working" ? `Respondiendo ahora · ${parts}` : parts;
};

function StudentRow({ activityId, student: s }: { activityId: string; student: DefenseStudentRow }) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  return (
    <li className="rounded-lg border border-line bg-surface shadow-1">
      <button type="button" className="flex w-full items-center gap-3 px-3.5 py-3 text-left sm:px-4" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="initial size-9 shrink-0" style={{ background: roomColor(s.studentId) }} aria-hidden="true">
          {roomInitials(s.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">
            {s.name}
            {s.division ? <span className="ml-1.5 font-normal text-text-3">{s.division}</span> : null}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-text-2">{statusLine(s)}</span>
        </span>
        <span className="hidden sm:block">
          <FragmentStrip checks={s.checks} />
        </span>
        <Badge tone={BAND_TONE[s.band]} className="shrink-0">
          {BAND_LABELS[s.band]}
        </Badge>
        <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open ? (
        <div className="grid gap-3 border-t border-line px-3.5 py-3.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-text-2">
            {s.pastes ? (
              <span className="inline-flex items-center gap-1.5">
                <ClipboardPaste className="size-3.5 text-text-3" aria-hidden="true" />
                Pegó texto de afuera {plural(s.pastes, "vez", "veces")}
              </span>
            ) : null}
            {s.leftApp ? (
              <span className="inline-flex items-center gap-1.5">
                <LogOut className="size-3.5 text-text-3" aria-hidden="true" />
                Salió de la página {plural(s.leftApp, "vez", "veces")}
              </span>
            ) : null}
            {s.code.length ? (
              <button type="button" className="font-medium text-ink underline decoration-lilac underline-offset-4" onClick={() => setViewing(true)}>
                Ver su código ({plural(s.code.length, "archivo", "archivos")})
              </button>
            ) : null}
            {s.sessionId ? (
              <Link to="/app/sesiones/$sessionId" params={{ sessionId: s.sessionId }} className="inline-flex items-center gap-1 font-medium text-ink underline decoration-lilac underline-offset-4">
                Ver el trabajo completo
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          {s.checks.length ? (
            <ol className="grid gap-3">
              {s.checks.map((c, i) => (
                <CheckCard key={c.id} check={c} index={i} />
              ))}
            </ol>
          ) : (
            <p className="text-[14px] text-text-2">Todavía no respondió ninguna pregunta.</p>
          )}
        </div>
      ) : null}
      {viewing ? <CodeDialog activityId={activityId} student={s} onClose={() => setViewing(false)} /> : null}
    </li>
  );
}

function CheckCard({ check: c, index }: { check: DefenseCheckView; index: number }) {
  return (
    <li className="grid gap-2.5 rounded-lg border border-line bg-paper/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-text-2">
          {index + 1}. {QUESTION_KIND_LABELS[c.kind]}
          {c.attempts > 1 ? " · con repregunta" : ""}
        </span>
        {c.verdict ? <Badge tone={VERDICT_TONE[c.verdict]}>{VERDICT_LABELS[c.verdict]}</Badge> : <Badge tone="neutral">Sin responder</Badge>}
      </div>
      <CodeBlock code={c.code} file={c.file} start={c.fromLine} />
      {c.change ? <CodeBlock diff code={`- ${c.change.before}\n+ ${c.change.after}`} /> : null}
      <p className="text-[14.5px] leading-6 font-medium text-ink">{renderInline(c.question, c.id)}</p>
      {c.answer ? <blockquote className="border-l-2 border-line-strong pl-3 text-[14px] leading-6 whitespace-pre-wrap text-text">{c.answer}</blockquote> : null}
      {c.reason ? <p className="text-[13px] leading-5 text-text-2">{c.reason}</p> : null}
    </li>
  );
}

function CodeDialog({ activityId, student, onClose }: { activityId: string; student: DefenseStudentRow; onClose: () => void }) {
  const q = useStudentCode(activityId, student.studentId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={`Código de ${student.name}`} description={student.code[0]?.uploadedBy === "teacher" ? "Lo cargaste vos." : "Lo cargó el alumno."}>
      {q.isPending ? (
        <SkeletonList rows={2} />
      ) : q.isError ? (
        <p className="text-[14px] text-rose" role="alert">
          {errorMessage(q.error)}
        </p>
      ) : (
        <div className="grid gap-3">
          {q.data.files.map((f) => (
            <CodeBlock key={f.name} code={f.text} file={f.name} />
          ))}
        </div>
      )}
    </Dialog>
  );
}

function LoadCodeDialog({ activityId, onClose }: { activityId: string; onClose: () => void }) {
  const load = useLoadStudentCode(activityId);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [pasted, setPasted] = useState("");
  const toSend = codeFilesToSend(files, pasted);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Cargar código de un alumno"
      description="Cuando entre con el enlace y escriba este mismo nombre, el tutor le va a preguntar por este código."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={name.trim().length < 2 || !toSend.length}
            loading={load.isPending}
            icon={<Plus className="size-4" />}
            onClick={() =>
              load.mutate(
                { studentName: name, files: toSend },
                {
                  onSuccess: () => {
                    toast.success("Código cargado");
                    onClose();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            Cargar código
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Nombre del alumno">{(p) => <Input id={p.id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}</Field>
        <CodeInput
          files={files}
          onFiles={setFiles}
          pasted={pasted}
          onPasted={setPasted}
          labels={{
            files: "Elegir archivos",
            lines: (n) => plural(n, "línea", "líneas"),
            paste: "O pegá el código",
            placeholder: "Pegá acá el HTML, el CSS o el JavaScript",
            remove: (f) => `Quitar ${f}`,
          }}
        />
      </div>
    </Dialog>
  );
}
