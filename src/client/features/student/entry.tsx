// Screens before the workspace: loading, invalid link, closed activity and the name form
// (with the resume-code path for students who started on another device).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Lock, PencilLine, RefreshCw, WifiOff } from "lucide-react";
import { Logo } from "@client/components/brand/logo";
import { Button } from "@client/components/ui/button";
import { Field, FormError, Input } from "@client/components/ui/field";
import { Skeleton } from "@client/components/ui/misc";
import { ApiError, errorMessage } from "@client/lib/api";
import { resumeCodeProblem, studentMetaLine } from "@shared/contracts/student-limits";
import type { StudentLinkInfo } from "@shared/contracts/student";
import { validateStudentName } from "@shared/domain/names";
import { setWorkspace, studentApi, studentKey } from "./api";
import { linkWasSeen, unsentDrafts, writeFlag, type DraftField } from "./hooks";

export function EntryShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <main id="contenido" className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-8 pb-10 sm:pt-14">
        <Logo className="mb-8 self-center" />
        {children}
      </main>
      {footer ? <footer>{footer}</footer> : null}
    </div>
  );
}

export function EntryLoading() {
  return (
    <EntryShell>
      <div className="rounded-xl border border-line bg-surface p-6 shadow-2" aria-busy="true" aria-label="Cargando la actividad">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-7 w-4/5" />
        <Skeleton className="mt-2 h-4 w-3/5" />
        <Skeleton className="mt-8 h-11 w-full" />
        <Skeleton className="mt-3 h-12 w-full" />
      </div>
    </EntryShell>
  );
}

export function EntryError({ token, error, onRetry }: { token: string; error: unknown; onRetry: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  const network = error instanceof ApiError && error.isNetwork;
  // This device opened the link before: it was replaced (or the activity deleted), not mistyped.
  const replaced = notFound && linkWasSeen(token);
  return (
    <EntryShell>
      <section className="rounded-xl border border-line bg-surface p-6 text-center shadow-2" role="alert">
        {notFound ? (
          <>
            <Lock className="mx-auto size-7 text-lilac-ink" aria-hidden="true" />
            <h1 className="mt-3 font-display text-xl font-semibold text-ink">
              {replaced ? "Este enlace ya no funciona" : "No encontramos esta actividad"}
            </h1>
            <p className="mt-2 text-[15px] leading-6 text-text-2">
              {replaced
                ? "Tu docente generó un enlace nuevo para esta actividad (o la quitó). Pedile el enlace nuevo: tu trabajo no se pierde."
                : "Revisá que el enlace esté completo. Si lo está, puede que tu docente lo haya cambiado por uno nuevo: pedíselo."}
            </p>
          </>
        ) : (
          <>
            {network ? <WifiOff className="mx-auto size-7 text-rose" aria-hidden="true" /> : null}
            <h1 className="mt-3 font-display text-xl font-semibold text-ink">{network ? "Sin conexión" : "No pudimos abrir la actividad"}</h1>
            <p className="mt-2 text-[15px] leading-6 text-text-2">{errorMessage(error)}</p>
            <Button variant="secondary" className="mt-5" icon={<RefreshCw className="size-4" />} onClick={onRetry}>
              Reintentar
            </Button>
          </>
        )}
      </section>
    </EntryShell>
  );
}

const dateFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
const opensAt = (iso: string) => `${dateFmt.format(new Date(iso))} a las ${timeFmt.format(new Date(iso))}`;

function ActivityHeading({ info, eyebrow = "Actividad" }: { info: StudentLinkInfo; eyebrow?: string }) {
  if (!info.activity) return null;
  const a = info.activity;
  const meta = studentMetaLine([a.subject, a.classroom]);
  return (
    <header>
      <p className="text-sm font-semibold text-lilac-ink">{eyebrow}</p>
      <h1 className="mt-1 font-display text-[26px] leading-tight font-semibold break-words text-ink">{a.title}</h1>
      {meta ? <p className="mt-1.5 text-sm text-text-2">{meta}</p> : null}
      {a.teacherName ? <p className="text-sm text-text-3">Con {a.teacherName}</p> : null}
    </header>
  );
}

const UNSENT_TEXT: Record<DraftField, string> = {
  chat: "tu último mensaje para el tutor",
  initial: "tu primera idea",
  final: "tu respuesta final",
  finals: "tus respuestas finales",
  reflection: "tu reflexión",
};

/** "Lo que escribiste no se envió": text kept on this device that the server never got. */
export function UnsentNotice({ fields, reopenable }: { fields: DraftField[]; reopenable: boolean }) {
  if (!fields.length) return null;
  const order: DraftField[] = ["chat", "initial", "final", "finals", "reflection"];
  const names = order.filter((f) => fields.includes(f)).map((f) => UNSENT_TEXT[f]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)}` : names[0]!;
  const plural = names.length > 1;
  return (
    <p className="mt-4 flex items-start gap-2.5 rounded-md bg-amber-soft px-3.5 py-3 text-left text-[15px] leading-6 text-text">
      <PencilLine className="mt-1 size-4 shrink-0 text-amber" aria-hidden="true" />
      <span>
        <strong className="font-semibold">
          {list.charAt(0).toUpperCase() + list.slice(1)} no {plural ? "se enviaron" : "se envió"}.
        </strong>{" "}
        {reopenable
          ? `${plural ? "Quedaron guardados" : "Quedó guardado"} en este dispositivo y ${plural ? "van" : "va"} a volver a aparecer si tu docente vuelve a abrir la actividad.`
          : `${plural ? "Quedaron guardados" : "Quedó guardado"} solo en este dispositivo; tu docente no ${plural ? "los" : "lo"} puede ver.`}
      </span>
    </p>
  );
}

/** The link works but the activity cannot be used right now. */
export function ClosedScreen({ token, info, onRetry, retrying }: { token: string; info: StudentLinkInfo; onRetry: () => void; retrying: boolean }) {
  // Re-check by itself when a scheduled activity opens (within the next 12 hours).
  useEffect(() => {
    if (info.availability !== "not_started" || !info.startsAt) return;
    const ms = new Date(info.startsAt).getTime() - Date.now();
    if (ms <= 0 || ms > 12 * 3_600_000) return;
    const t = setTimeout(onRetry, ms + 1500);
    return () => clearTimeout(t);
  }, [info.availability, info.startsAt, onRetry]);

  const [unsent] = useState(() => unsentDrafts(token));
  const scheduled = info.availability === "not_started";
  const reopenable = info.availability === "inactive" || scheduled;
  const Icon = scheduled ? CalendarClock : Lock;
  const MessageTag = info.activity ? "p" : "h1";
  return (
    <EntryShell>
      <section className="rounded-xl border border-line bg-surface p-6 shadow-2">
        <ActivityHeading info={info} />
        <div className={info.activity ? "mt-6 border-t border-line pt-5" : ""} role="status">
          {/* Without activity details (draft/archived) the message is the page heading. */}
          <MessageTag className="flex items-start gap-2.5 text-[17px] leading-7 font-semibold text-ink">
            <Icon className="mt-1 size-5 shrink-0 text-lilac-ink" aria-hidden="true" />
            {info.message}
          </MessageTag>
          {scheduled && info.startsAt ? (
            <p className="mt-2 text-[15px] leading-6 text-text-2">
              Abre el <strong className="font-semibold text-text">{opensAt(info.startsAt)}</strong>. Si dejás esta página abierta, se va a
              actualizar sola.
            </p>
          ) : (
            <p className="mt-2 text-[15px] leading-6 text-text-2">
              {unsent.length ? "Lo que ya habías enviado quedó guardado. " : ""}Si creés que es un error, avisale a tu docente.
            </p>
          )}
          <UnsentNotice fields={unsent} reopenable={reopenable} />
          <Button variant="secondary" className="mt-5 w-full sm:w-auto" loading={retrying} icon={<RefreshCw className="size-4" />} onClick={onRetry}>
            Volver a fijarme
          </Button>
        </div>
      </section>
    </EntryShell>
  );
}

type Mode = { kind: "join" } | { kind: "resume"; reason: "required" | "chosen" };

/** Name form; on a name that already has work, asks for the resume code. */
export function JoinScreen({ token, info }: { token: string; info: StudentLinkInfo }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: "join" });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const noticeId = useId();
  const resume = mode.kind === "resume";
  const nameLocked = mode.kind === "resume" && mode.reason === "required";

  useEffect(() => {
    if (mode.kind === "resume") (mode.reason === "required" ? codeRef : nameRef).current?.focus();
  }, [mode]);

  /** Shows field errors and moves the focus to the first wrong field. */
  function showFields(next: Record<string, string>) {
    setFields(next);
    if (next.name && !nameLocked) nameRef.current?.focus();
    else if (next.code) codeRef.current?.focus();
  }

  function handleError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.code === "unavailable") {
        void qc.invalidateQueries({ queryKey: studentKey(token) });
        return;
      }
      if (err.code === "resume_required") {
        setMode({ kind: "resume", reason: "required" });
        setError(null);
        setFields({});
        return;
      }
      // Validation errors go next to the field; anything else (wrong code, limits) above the button.
      if (err.code === "invalid" && Object.keys(err.fields).length) {
        setError(null);
        showFields(err.fields);
      } else {
        setFields({});
        setError(err.message);
        if (err.code === "wrong_code") {
          setCode("");
          codeRef.current?.focus();
        }
      }
      return;
    }
    setError(errorMessage(err) || "No pudimos entrar. Probá de nuevo.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    // Checked here first: an empty name or a code with the wrong length never reaches the
    // server, so it never uses up one of the attempts.
    const problems: Record<string, string> = {};
    const v = validateStudentName(name);
    if (!v.ok) problems.name = name.trim() ? v.error : "Escribí tu nombre y apellido.";
    if (resume) {
      const p = resumeCodeProblem(code);
      if (p) problems.code = p;
    }
    if (Object.keys(problems).length) {
      showFields(problems);
      return;
    }
    setBusy(true);
    setFields({});
    try {
      if (mode.kind === "join") {
        const r = await studentApi.join(token, name);
        if (r.created) writeFlag(`as-new:${token}:${r.workspace.resumeCode}`, true);
        setWorkspace(qc, token, r.workspace);
      } else {
        const r = await studentApi.resume(token, name, code);
        setWorkspace(qc, token, r.workspace);
      }
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EntryShell
      footer={
        <p className="mx-auto max-w-md px-6 pb-8 text-center text-[13px] leading-5 text-text-3">
          Solo se guarda tu nombre y lo que escribís en la actividad. Mientras trabajás también se registra si pegás texto copiado de afuera o
          si salís de la página por un rato.{" "}
          <a href="/privacidad" className="-my-3 inline-block py-3 font-medium text-lilac-ink underline underline-offset-2">
            Privacidad
          </a>
        </p>
      }
    >
      <section className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-6">
        <ActivityHeading info={info} />
        <form onSubmit={submit} noValidate className="mt-6 space-y-4 border-t border-line pt-5">
          {resume ? (
            <div id={noticeId} className="space-y-2 rounded-md bg-lilac-soft px-3.5 py-3 text-[15px] leading-6 text-lilac-ink">
              {mode.reason === "required" ? (
                <>
                  <p>
                    Ya hay un trabajo empezado como <strong className="font-semibold break-words">«{name.trim()}»</strong>. Si sos vos, escribí el
                    código que te mostramos al empezar. Si no lo tenés, pedíselo a tu docente.
                  </p>
                  <p>
                    <strong className="font-semibold">¿No empezaste vos?</strong> Puede que otra persona haya entrado con tu nombre. Avisale a tu
                    docente: puede ver ese trabajo, darte el código o borrarlo para que entres vos.
                  </p>
                </>
              ) : (
                <p>Escribí tu nombre como lo pusiste al empezar y el código de 6 letras y números que te mostramos.</p>
              )}
            </div>
          ) : null}

          <Field
            label={resume ? "Tu nombre" : <span className="q-hang text-[19px] font-normal">¿Cómo te llamás?</span>}
            hint={resume ? undefined : "Escribí tu nombre y apellido. Tu docente va a ver tu trabajo con este nombre."}
            error={fields.name}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                ref={nameRef}
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fields.name) setFields(({ name: _drop, ...rest }) => rest);
                }}
                autoComplete="name"
                autoCapitalize="words"
                maxLength={120}
                required
                readOnly={nameLocked}
                className={nameLocked ? "bg-sunken" : undefined}
              />
            )}
          </Field>

          {resume ? (
            <Field label="Tu código" hint="Son 6 letras y números, por ejemplo K7M2QX." error={fields.code}>
              {({ id, describedBy, invalid }) => (
                <Input
                  ref={codeRef}
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 9));
                    if (fields.code) setFields(({ code: _drop, ...rest }) => rest);
                  }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="font-mono text-lg tracking-[0.25em] uppercase"
                  required
                />
              )}
            </Field>
          ) : null}

          <FormError message={error} />

          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {resume ? "Seguir mi trabajo" : "Entrar a la actividad"}
          </Button>

          {resume ? (
            <Button
              variant="ghost"
              className="h-auto min-h-11 w-full whitespace-normal py-2 text-center"
              onClick={() => {
                setMode({ kind: "join" });
                setCode("");
                setError(null);
                setFields({});
                if (mode.reason === "required") setName("");
                setTimeout(() => nameRef.current?.focus(), 0);
              }}
            >
              {mode.reason === "required" ? "No soy yo: entrar con otro nombre" : "Volver"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="h-auto min-h-11 w-full whitespace-normal py-2 text-center"
              onClick={() => {
                setMode({ kind: "resume", reason: "chosen" });
                setError(null);
                setFields({});
              }}
            >
              ¿Empezaste en otro dispositivo? Usá tu código
            </Button>
          )}
        </form>
      </section>

      <section aria-label="Cómo funciona" className="mt-6 px-1 text-[15px] leading-6 text-text-2">
        <p>
          Vas a conversar con un <strong className="font-semibold text-ink">tutor de IA</strong> que te ayuda a pensar con preguntas, sin
          darte la respuesta. Al final escribís tu respuesta y contás cómo lo pensaste.
        </p>
      </section>
    </EntryShell>
  );
}
