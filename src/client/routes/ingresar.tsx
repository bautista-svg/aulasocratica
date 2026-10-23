import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { optionalEnum, searchParams } from "@client/lib/search";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button, buttonClass } from "@client/components/ui/button";
import { Field, FormError, Input } from "@client/components/ui/field";
import { Notice } from "@client/components/ui/misc";
import { ApiError, errorMessage } from "@client/lib/api";
import { compactErrors, emailError, focusFirstInvalid } from "@client/lib/forms";
import { useMe, useStartWorkspace } from "@client/lib/session";
import { useLogin, useRecover } from "@client/features/account/api";
import { PasswordInput, PASSWORD_MIN, StrengthMeter } from "@client/features/account/password-input";
import { RecoveryCodePanel } from "@client/features/account/recovery-code-panel";
import { PublicLayout } from "@client/features/account/public-layout";
import { GoogleButton, OrDivider, useAuthProviders } from "@client/features/account/google-button";
import { usePageTitle } from "@client/lib/page-title";

const GOOGLE_FAILURES = ["cancelado", "vencido", "sin-verificar", "otra-cuenta", "suspendido", "ocupado", "no-disponible", "error"] as const;
type GoogleFailure = (typeof GOOGLE_FAILURES)[number];

/** Why "Continuar con Google" came back here (the server redirects with ?google=…). */
const GOOGLE_MESSAGES: Record<GoogleFailure, string> = {
  cancelado: "Cancelaste el ingreso con Google. Podés probar de nuevo o entrar con tu correo.",
  vencido: "El ingreso con Google tardó demasiado o empezó en otra pestaña. Probá de nuevo.",
  "sin-verificar": "Tu cuenta de Google no tiene el correo verificado. Verificalo en Google o entrá con tu correo y contraseña.",
  "otra-cuenta": "Ese correo ya está vinculado a otra cuenta de Google. Entrá con esa cuenta o con tu correo y contraseña.",
  suspendido: "Este espacio fue suspendido por el administrador del sitio.",
  ocupado: "Se están creando muchas cuentas en este momento. Probá de nuevo en unos minutos.",
  "no-disponible": "El ingreso con Google no está disponible por ahora. Entrá con tu correo y contraseña.",
  error: "No pudimos completar el ingreso con Google. Probá de nuevo en un momento.",
};

export const Route = createFileRoute("/ingresar")({
  validateSearch: searchParams({ modo: optionalEnum(["recuperar"]), google: optionalEnum(GOOGLE_FAILURES) }),
  component: SignInPage,
});

function SignInPage() {
  const { modo, google } = Route.useSearch();
  const recovering = modo === "recuperar";
  usePageTitle(recovering ? "Recuperar la cuenta" : "Ingresar");
  const me = useMe();
  const teacher = me.data?.teacher ?? null;
  // Kept here: after recovering, "me" already has an account and the page would switch to "Ya estás en tu cuenta".
  const [recovered, setRecovered] = useState<{ code: string; email: string } | null>(null);

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
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-16 sm:pt-12">
        {google && !teacher?.hasAccount ? (
          <Notice tone={google === "cancelado" ? "neutral" : "amber"} className="mb-6" title="No se completó el ingreso con Google">
            {GOOGLE_MESSAGES[google]}
          </Notice>
        ) : null}
        {recovered ? (
          <NewCode code={recovered.code} email={recovered.email} />
        ) : teacher?.hasAccount ? (
          <AlreadyIn email={teacher.email} />
        ) : recovering ? (
          <RecoverForm anonymousHere={Boolean(teacher)} onRecovered={setRecovered} />
        ) : (
          <LoginForm anonymousHere={Boolean(teacher)} />
        )}
        {!teacher?.hasAccount && !recovered ? <StartWithoutAccount hasWorkspace={Boolean(teacher)} /> : null}
      </div>
    </PublicLayout>
  );
}

function AlreadyIn({ email }: { email: string | null }) {
  return (
    <>
      <h1 className="font-display text-[32px] leading-tight font-semibold text-ink">Ya estás en tu cuenta</h1>
      <p className="mt-3 leading-7 text-text-2">
        Este dispositivo tiene abierta la cuenta <strong className="break-all text-text">{email}</strong>. Para entrar con otra, primero cerrá la
        sesión desde Mi espacio.
      </p>
      <Link to="/app" className={buttonClass("primary", "lg", "mt-6 w-full")}>
        Ir a mi espacio
      </Link>
    </>
  );
}

function LoginForm({ anonymousHere }: { anonymousHere: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);
  const login = useLogin();
  const navigate = useNavigate();
  const google = Boolean(useAuthProviders().data?.google);
  const fields = login.error instanceof ApiError ? login.error.fields : {};
  // Editing a field hides the messages about the previous attempt (they would be stale).
  const edited = (key: "email" | "password") => {
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
    if (login.isError) login.reset();
  };

  return (
    <>
      <h1 className="font-display text-[32px] leading-tight font-semibold text-ink">Entrar a tu cuenta</h1>
      <p className="mt-3 leading-7 text-text-2">
        {google ? "Con Google o con el correo y la contraseña de tu cuenta." : "Con el correo y la contraseña que agregaste a tu espacio."}
      </p>
      {anonymousHere ? (
        <Notice tone="lilac" className="mt-5">
          En este dispositivo ya tenés un espacio sin cuenta. Si entrás, lo que hiciste acá se suma a tu cuenta: no se pierde nada.
        </Notice>
      ) : null}
      <GoogleButton className="mt-6" />
      <OrDivider label="o con tu correo" className="mt-6" />
      <form
        ref={formRef}
        noValidate
        className="mt-6 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const found = compactErrors({ email: emailError(email), password: password ? undefined : "Escribí tu contraseña." });
          setErrors(found);
          if (Object.keys(found).length > 0) {
            focusFirstInvalid(formRef.current);
            return;
          }
          login.mutate(
            { email: email.trim(), password },
            {
              onError: () => focusFirstInvalid(formRef.current),
              onSuccess: (r) => {
                toast.success(
                  "¡Hola de nuevo!",
                  r.merged ? { description: "Sumamos a tu cuenta lo que habías hecho en este dispositivo." } : undefined,
                );
                void navigate({ to: "/app" });
              },
            },
          );
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
              autoFocus
            />
          )}
        </Field>
        <Field label="Contraseña" error={errors.password ?? fields.password}>
          {(p) => (
            <PasswordInput
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                edited("password");
              }}
            />
          )}
        </Field>
        <FormError message={login.isError && !fields.email && !fields.password ? errorMessage(login.error) : null} />
        <Button type="submit" size="lg" loading={login.isPending}>
          Entrar
        </Button>
      </form>
      <p className="mt-5 text-[15px]">
        <Link
          to="/ingresar"
          search={{ modo: "recuperar" }}
          className="-my-2.5 inline-flex min-h-11 items-center font-semibold text-ink underline decoration-lilac underline-offset-4"
        >
          Olvidé mi contraseña
        </Link>
      </p>
    </>
  );
}

function NewCode({ code, email }: { code: string; email: string }) {
  const navigate = useNavigate();
  return (
    <>
      <h1 className="mb-5 font-display text-[32px] leading-tight font-semibold text-ink">Listo: ya tenés una contraseña nueva</h1>
      <RecoveryCodePanel
        code={code}
        email={email}
        title="Tu código de recuperación nuevo"
        doneLabel="Ir a mi espacio"
        onDone={() => void navigate({ to: "/app" })}
      />
      <p className="mt-4 text-sm leading-6 text-text-2">El código que usaste recién ya no sirve. Cerramos la sesión en tus otros dispositivos.</p>
    </>
  );
}

function RecoverForm({ anonymousHere, onRecovered }: { anonymousHere: boolean; onRecovered: (r: { code: string; email: string }) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; recoveryCode?: string; newPassword?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);
  const recover = useRecover((r) => onRecovered({ code: r.recoveryCode, email: r.teacher.email ?? email.trim() }));
  const fields = recover.error instanceof ApiError ? recover.error.fields : {};
  const edited = (key: "email" | "recoveryCode" | "newPassword") => {
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
    if (recover.isError) recover.reset();
  };

  return (
    <>
      <Link
        to="/ingresar"
        activeOptions={{ exact: true }}
        className="mb-2 -mt-2.5 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-2 hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Volver a ingresar
      </Link>
      <h1 className="font-display text-[32px] leading-tight font-semibold text-ink">Recuperar la cuenta</h1>
      <p className="mt-3 leading-7 text-text-2">
        No mandamos correos. Para crear una contraseña nueva necesitás el código de recuperación que guardaste al crear la cuenta (o el último que
        generaste).
      </p>
      {anonymousHere ? (
        <Notice tone="ink" className="mt-5">
          En este dispositivo tenés un espacio sin cuenta: lo que hiciste ahí se suma a tu cuenta al recuperarla.
        </Notice>
      ) : null}
      <form
        ref={formRef}
        noValidate
        className="mt-6 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const found = compactErrors({
            email: emailError(email),
            recoveryCode:
              code.replace(/[\s-]/g, "").length < 8
                ? "Escribí el código de recuperación completo: son 16 letras y números."
                : undefined,
            newPassword: password.length < PASSWORD_MIN ? `La contraseña nueva tiene que tener al menos ${PASSWORD_MIN} caracteres.` : undefined,
          });
          setErrors(found);
          if (Object.keys(found).length > 0) {
            focusFirstInvalid(formRef.current);
            return;
          }
          recover.mutate(
            { email: email.trim(), recoveryCode: code.trim(), newPassword: password },
            { onError: () => focusFirstInvalid(formRef.current) },
          );
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
              autoFocus
            />
          )}
        </Field>
        <Field
          label="Código de recuperación"
          error={errors.recoveryCode ?? fields.recoveryCode}
          hint="Son 16 letras y números, por ejemplo ABCD-EFGH-JKLM-NPQR. Da igual si usás mayúsculas."
        >
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              required
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono tracking-wider"
              maxLength={40}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                edited("recoveryCode");
              }}
            />
          )}
        </Field>
        <Field label="Contraseña nueva" error={errors.newPassword ?? fields.newPassword} hint={`Al menos ${PASSWORD_MIN} caracteres.`}>
          {(p) => (
            <>
              <PasswordInput
                id={p.id}
                aria-describedby={p.describedBy}
                invalid={p.invalid}
                autoComplete="new-password"
                required
                maxLength={200}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  edited("newPassword");
                }}
              />
              <StrengthMeter password={password} />
            </>
          )}
        </Field>
        <FormError message={recover.isError && !fields.email && !fields.recoveryCode && !fields.newPassword ? errorMessage(recover.error) : null} />
        <Button type="submit" size="lg" loading={recover.isPending}>
          Crear contraseña nueva
        </Button>
      </form>
    </>
  );
}

function StartWithoutAccount({ hasWorkspace }: { hasWorkspace: boolean }) {
  const start = useStartWorkspace();
  const navigate = useNavigate();
  return (
    <div className="mt-10 border-t border-line pt-6">
      {hasWorkspace ? (
        <p className="text-[15px] text-text-2">
          ¿Preferís seguir sin cuenta?{" "}
          <Link to="/app" className="-my-2.5 inline-flex min-h-11 items-center font-semibold text-ink underline decoration-lilac underline-offset-4">
            Volver a mi espacio en este dispositivo
          </Link>
        </p>
      ) : (
        <>
          <p className="text-[15px] text-text-2">¿No tenés cuenta? No hace falta: empezá ahora y, si querés, le agregás una cuenta después.</p>
          <Button
            variant="secondary"
            className="mt-3 w-full"
            loading={start.isPending}
            onClick={() => start.mutate(undefined, { onSuccess: () => void navigate({ to: "/app" }) })}
          >
            Empezar sin cuenta
          </Button>
          <FormError message={start.isError ? errorMessage(start.error) : null} />
        </>
      )}
    </div>
  );
}
