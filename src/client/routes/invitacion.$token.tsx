// The page an invitation link opens ("Compartir aula"). It shows the classroom, who invites and
// with which role. Accepting needs an account: without one, the teacher enters (Google or email)
// or creates it right here, and comes back to this same page to accept.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Clock, Link2Off, School, ShieldCheck, Users } from "lucide-react";
import { Button, buttonClass } from "@client/components/ui/button";
import { Field, FormError, Input } from "@client/components/ui/field";
import { Notice, Skeleton } from "@client/components/ui/misc";
import { ApiError, errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import { fmtDate } from "@client/lib/format";
import { compactErrors, emailError, focusFirstInvalid } from "@client/lib/forms";
import { usePageTitle } from "@client/lib/page-title";
import { useMe, useStartWorkspace } from "@client/lib/session";
import { useLogin, useRegister } from "@client/features/account/api";
import { PublicLayout } from "@client/features/account/public-layout";
import { GOOGLE_FAILURES, GOOGLE_MESSAGES, GoogleButton, OrDivider, useAuthProviders } from "@client/features/account/google-button";
import { optionalEnum, searchParams } from "@client/lib/search";
import { PasswordInput, PASSWORD_MIN, StrengthMeter } from "@client/features/account/password-input";
import { RecoveryCodePanel } from "@client/features/account/recovery-code-panel";
import { inviteKey, useAcceptInvite, useInvite } from "@client/features/sharing/api";
import { ROLE_INFO, ROLE_LABEL, type MemberRole } from "@shared/domain/sharing";
import type { InvitePreview } from "@shared/contracts/sharing";

export const Route = createFileRoute("/invitacion/$token")({
  validateSearch: searchParams({ google: optionalEnum(GOOGLE_FAILURES) }),
  component: InvitePage,
});

const ENDED: Record<Exclude<InvitePreview["status"], "valid">, { title: string; text: string }> = {
  expired: { title: "Este enlace venció", text: "Las invitaciones duran 7 días." },
  used: { title: "Este enlace ya se usó", text: "Cada invitación sirve una sola vez." },
  revoked: { title: "Este enlace fue anulado", text: "Quien lo creó lo dejó sin efecto." },
};

function InvitePage() {
  const { token } = Route.useParams();
  const q = useInvite(token);
  const me = useMe();
  usePageTitle(q.data ? ["Invitación", q.data.classroom.label] : "Invitación a un aula");
  const teacher = me.data?.teacher ?? null;

  return (
    <PublicLayout
      nav={
        teacher ? (
          <Link to="/app" className={buttonClass("ghost", "sm")}>
            Mi espacio
          </Link>
        ) : undefined
      }
    >
      <div className="mx-auto w-full max-w-lg px-5 pt-6 pb-16 sm:pt-12">
        {q.isPending ? (
          <div className="rounded-xl border border-line bg-surface p-6 shadow-1" aria-busy="true" aria-label="Cargando la invitación">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-4 h-8 w-3/4" />
            <Skeleton className="mt-3 h-4 w-2/3" />
          </div>
        ) : q.isError ? (
          <Missing error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <InviteCard invite={q.data} token={token} />
        )}
      </div>
    </PublicLayout>
  );
}

function Missing({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const gone = error instanceof ApiError && error.status === 404;
  return (
    <section className="rounded-xl border border-line bg-surface p-6 text-center shadow-1">
      <Link2Off className="mx-auto size-8 text-lilac" aria-hidden="true" />
      <h1 className="mt-3 font-display text-2xl font-semibold text-ink">{gone ? "Este enlace no existe" : "No pudimos abrir la invitación"}</h1>
      <p className="mt-2 leading-7 text-text-2">{errorMessage(error)}</p>
      {gone ? (
        <Link to="/" className={buttonClass("secondary", "md", "mt-5")}>
          Ir al inicio
        </Link>
      ) : (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </section>
  );
}

function InviteCard({ invite, token }: { invite: InvitePreview; token: string }) {
  const { viewer } = invite;
  const ended = invite.status === "valid" ? null : ENDED[invite.status];
  const hasAccess = viewer.currentRole !== null;
  // Kept here, not in <NeedsAccount>: creating the account refreshes the invitation (now with an
  // account), and the recovery code must stay on screen until the teacher saved it.
  const [recovery, setRecovery] = useState<{ code: string; email: string } | null>(null);

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface shadow-2">
      <header className="relative border-b border-line bg-lilac-soft/60 px-6 pt-6 pb-5">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-lilac-ink">
          <Users className="size-4" aria-hidden="true" />
          Invitación a un aula compartida
        </p>
        <h1 className="mt-2 font-display text-[28px] leading-tight font-semibold text-ink">{invite.classroom.label}</h1>
        {invite.classroom.school ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-[15px] text-text-2">
            <School className="size-4" aria-hidden="true" />
            {invite.classroom.school}
          </p>
        ) : null}
      </header>

      <div className="px-6 py-5">
        <p className="text-[15px] leading-7 text-text">
          <strong className="font-semibold">{invite.invitedByName}</strong> te invita como <strong className="font-semibold">{ROLE_LABEL[invite.role]}</strong>
          {invite.ownerName !== invite.invitedByName ? (
            <>
              {" "}
              al aula de <strong className="font-semibold">{invite.ownerName}</strong>
            </>
          ) : null}
          .
        </p>
        <div className="mt-3 flex gap-3 rounded-md bg-paper px-4 py-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lilac-ink" aria-hidden="true" />
          <p className="text-sm leading-6 text-text-2">
            <span className="font-semibold text-text">{ROLE_LABEL[invite.role]}:</span> {ROLE_INFO[invite.role]}
          </p>
        </div>
        {!ended ? (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-text-3">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            Sirve una sola vez y vence el {fmtDate(invite.expiresAt)}.
          </p>
        ) : null}
      </div>

      <div className="border-t border-line px-6 py-5">
        {recovery ? (
          <RecoveryCodePanel code={recovery.code} email={recovery.email} doneLabel="Seguir con la invitación" onDone={() => setRecovery(null)} />
        ) : viewer.currentRole === "owner" ? (
          <Notice tone="ink" title="Esta aula es tuya" action={<OpenClassroom id={invite.classroom.id} />}>
            Mandale este enlace al docente que quieras sumar.
          </Notice>
        ) : ended ? (
          hasAccess ? (
            <Notice tone="leaf" title="Ya tenés acceso a esta aula" action={<OpenClassroom id={invite.classroom.id} />}>
              Entrás como {ROLE_LABEL[viewer.currentRole as MemberRole]}.
            </Notice>
          ) : (
            <div className="flex gap-3">
              <Clock className="mt-1 size-5 shrink-0 text-amber" aria-hidden="true" />
              <div>
                <h2 className="font-semibold text-text">{ended.title}</h2>
                <p className="mt-1 text-sm leading-6 text-text-2">
                  {ended.text} Pedile a {invite.invitedByName} que cree uno nuevo desde «Compartir», en el aula.
                </p>
              </div>
            </div>
          )
        ) : viewer.hasAccount ? (
          <Accept invite={invite} token={token} />
        ) : (
          <NeedsAccount token={token} signedIn={viewer.signedIn} onRegistered={setRecovery} />
        )}
      </div>
    </article>
  );
}

function OpenClassroom({ id }: { id: string }) {
  return (
    <Link to="/app/aulas/$classroomId" params={{ classroomId: id }} className={buttonClass("primary", "sm")}>
      Abrir el aula
    </Link>
  );
}

function Accept({ invite, token }: { invite: InvitePreview; token: string }) {
  const accept = useAcceptInvite(token);
  const navigate = useNavigate();
  const current = invite.viewer.currentRole;
  return (
    <div className="grid gap-3">
      {current && current !== "owner" ? (
        <p className="text-sm leading-6 text-text-2">
          Ya tenés acceso como <strong className="text-text">{ROLE_LABEL[current]}</strong>. Si aceptás, pasás a ser{" "}
          <strong className="text-text">{ROLE_LABEL[invite.role]}</strong>.
        </p>
      ) : (
        <p className="text-sm leading-6 text-text-2">Al aceptar, el aula aparece en tus aulas, en Inicio y en Alertas.</p>
      )}
      <FormError message={accept.isError ? errorMessage(accept.error) : null} />
      <Button
        size="lg"
        loading={accept.isPending}
        onClick={() =>
          accept.mutate(undefined, {
            onSuccess: (r) => {
              toast.success(`Ya tenés acceso a «${invite.classroom.label}»`, { description: `Entrás como ${ROLE_LABEL[r.role]}.` });
              void navigate({ to: "/app/aulas/$classroomId", params: { classroomId: r.classroomId } });
            },
          })
        }
      >
        Aceptar y abrir el aula
      </Button>
    </div>
  );
}

/** Without an account: enter with Google or email, or create the account here; then accept. */
function NeedsAccount({
  token,
  signedIn,
  onRegistered,
}: {
  token: string;
  signedIn: boolean;
  onRegistered: (r: { code: string; email: string }) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const google = Boolean(useAuthProviders().data?.google);
  const failure = Route.useSearch().google;
  const qc = useQueryClient();
  const back = () => void qc.invalidateQueries({ queryKey: inviteKey(token) });

  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-ink">Para sumarte necesitás una cuenta</h2>
      <p className="mt-1 text-sm leading-6 text-text-2">
        Así el aula te sigue en cualquier dispositivo. {google ? "Entrá con Google o con tu correo" : "Entrá con tu correo"}; si no tenés cuenta, la creás acá
        mismo y volvés a esta invitación.
      </p>
      {failure ? (
        <Notice tone={failure === "cancelado" ? "neutral" : "amber"} className="mt-4" title="No se completó el ingreso con Google">
          {GOOGLE_MESSAGES[failure]}
        </Notice>
      ) : null}
      {signedIn ? (
        <Notice tone="lilac" className="mt-4">
          Lo que hiciste en este dispositivo sin cuenta se suma a tu cuenta: no se pierde nada.
        </Notice>
      ) : null}
      <GoogleButton next={`/invitacion/${token}`} className="mt-5" />
      <OrDivider label="o con tu correo" className="mt-5" />
      <div role="group" aria-label="Con tu correo" className="mt-5 grid grid-cols-2 rounded-md border border-line bg-paper p-1">
        {(
          [
            ["login", "Ya tengo cuenta"],
            ["register", "Crear cuenta"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "min-h-11 rounded-sm px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lilac-ink",
              mode === value ? "bg-ink text-white" : "text-text-2 hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <EmailForm key={mode} mode={mode} signedIn={signedIn} onLoggedIn={back} onRegistered={onRegistered} />
    </div>
  );
}

function EmailForm({
  mode,
  signedIn,
  onLoggedIn,
  onRegistered,
}: {
  mode: "login" | "register";
  signedIn: boolean;
  onLoggedIn: () => void;
  onRegistered: (r: { code: string; email: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);
  const login = useLogin();
  const register = useRegister();
  const start = useStartWorkspace();
  const pending = login.isPending || register.isPending || start.isPending;
  const failed = mode === "login" ? login.error : (register.error ?? start.error);
  const fields = failed instanceof ApiError ? failed.fields : {};
  const edited = (key: "email" | "password") => {
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
    login.reset();
    register.reset();
  };

  const submit = async () => {
    const found = compactErrors({
      email: emailError(email),
      password: !password
        ? "Escribí tu contraseña."
        : mode === "register" && password.length < PASSWORD_MIN
          ? `Usá al menos ${PASSWORD_MIN} caracteres.`
          : undefined,
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstInvalid(formRef.current);
    try {
      if (mode === "login") {
        const r = await login.mutateAsync({ email: email.trim(), password });
        toast.success("¡Hola de nuevo!", r.merged ? { description: "Sumamos a tu cuenta lo que habías hecho en este dispositivo." } : undefined);
        onLoggedIn();
      } else {
        // A device without a workspace gets one first: the account is that workspace with an email.
        if (!signedIn) await start.mutateAsync(undefined);
        const r = await register.mutateAsync({ email: email.trim(), password });
        onRegistered({ code: r.recoveryCode, email: email.trim() });
      }
    } catch {
      focusFirstInvalid(formRef.current);
    }
  };

  return (
    <form
      ref={formRef}
      noValidate
      className="mt-4 grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Correo" error={errors.email ?? fields.email}>
        {(p) => (
          <Input
            id={p.id}
            aria-describedby={p.describedBy}
            invalid={p.invalid}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              edited("email");
            }}
          />
        )}
      </Field>
      <Field
        label="Contraseña"
        hint={mode === "register" ? `Al menos ${PASSWORD_MIN} caracteres. Una frase que recuerdes es ideal.` : undefined}
        error={errors.password ?? fields.password}
      >
        {(p) => (
          <PasswordInput
            id={p.id}
            aria-describedby={p.describedBy}
            invalid={p.invalid}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              edited("password");
            }}
          />
        )}
      </Field>
      {mode === "register" ? <StrengthMeter password={password} /> : null}
      <FormError message={failed && !fields.email && !fields.password ? errorMessage(failed) : null} />
      <Button type="submit" size="lg" loading={pending}>
        {mode === "login" ? "Entrar y seguir" : "Crear cuenta y seguir"}
      </Button>
      {mode === "login" ? (
        <Link
          to="/ingresar"
          search={{ modo: "recuperar" }}
          className="-my-2.5 inline-flex min-h-11 items-center justify-self-start text-[15px] font-semibold text-ink underline decoration-lilac underline-offset-4"
        >
          Olvidé mi contraseña
        </Link>
      ) : null}
    </form>
  );
}
