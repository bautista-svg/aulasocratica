import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { KeyRound, LogIn, LogOut, Lock, Mail, Smartphone } from "lucide-react";
import { Button, buttonClass } from "@client/components/ui/button";
import { Dialog, ConfirmDialog } from "@client/components/ui/dialog";
import { Field, FormError, Input } from "@client/components/ui/field";
import { Badge } from "@client/components/ui/misc";
import { ApiError, errorMessage } from "@client/lib/api";
import { compactErrors, emailError, focusFirstInvalid } from "@client/lib/forms";
import type { Me } from "@shared/contracts/auth";
import { useChangePassword, useForgetWorkspace, useLogout, useNewRecoveryCode, useRegister } from "./api";
import { PasswordInput, PASSWORD_MIN, StrengthMeter } from "./password-input";
import { RecoveryCodePanel } from "./recovery-code-panel";
import { GoogleButton, OrDivider } from "./google-button";

/** Retention rules, as implemented in src/server/services/retention.ts. */
export function RetentionNote() {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-text-2">
      <li>Un espacio sin cuenta y sin nada creado se borra a los 30 días sin usarlo.</li>
      <li>Un espacio sin cuenta con aulas, materiales o informes se borra a los 12 meses sin usarlo.</li>
      <li>Un espacio con cuenta se guarda hasta que vos lo borres.</li>
    </ul>
  );
}

export function AccountSection({ me }: { me: Me }) {
  const [code, setCode] = useState<string | null>(null);
  if (code) {
    return <RecoveryCodePanel code={code} email={me.email} onDone={() => setCode(null)} doneLabel="Listo, ya lo guardé" />;
  }
  return me.hasAccount ? <WithAccount me={me} onNewCode={setCode} /> : <CreateAccount me={me} onCreated={setCode} />;
}

function CreateAccount({ me, onCreated }: { me: Me; onCreated: (code: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(me.displayName);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);
  const register = useRegister((r) => {
    toast.success("Cuenta creada");
    onCreated(r.recoveryCode);
  });
  const fields = register.error instanceof ApiError ? register.error.fields : {};
  useEffect(() => setName((n) => n || me.displayName), [me.displayName]);
  // Editing a field hides the messages about the previous attempt (they would be stale).
  const edited = (key: "email" | "password" | "displayName") => {
    if (key !== "displayName" && errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
    if (register.isError) register.reset();
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 rounded-[14px] border border-lilac/40 bg-lilac-soft/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-text-2">
          <span className="font-semibold text-ink">¿Ya tenés una cuenta?</span> Entrá a tu cuenta: lo que hiciste en este dispositivo se suma a
          ella.
        </p>
        <Link to="/ingresar" className={buttonClass("secondary", "sm", "shrink-0")}>
          <LogIn className="size-4" aria-hidden="true" />
          Entrar con mi cuenta
        </Link>
      </div>
      <div className="flex items-start gap-3 rounded-md bg-sunken px-4 py-3.5">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden="true" />
        <div className="text-sm leading-6 text-text-2">
          <p className="font-semibold text-text">Tu espacio se abre solo desde este dispositivo</p>
          <p>
            Lo que creás se guarda en el servidor de Aula Socrática, pero para entrar se usa una cookie de este navegador. Si la borrás, usás otro
            navegador o perdés el dispositivo, no vas a poder volver a entrar.
          </p>
          <RetentionNote />
        </div>
      </div>

      <h3 className="mt-6 font-display text-lg font-semibold text-ink">Crear una cuenta</h3>
      <p className="mt-1 text-sm leading-6 text-text-2">
        Con tu cuenta de Google, o con un correo y una contraseña, podés abrir este mismo espacio desde cualquier dispositivo. No se pierde nada de lo
        que ya hiciste.
      </p>
      <GoogleButton next="/app/cuenta" label="Crear cuenta con Google" className="mt-4 sm:w-auto" />
      <OrDivider label="o con correo y contraseña" className="mt-5" />
      <form
        ref={formRef}
        noValidate
        className="mt-4 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const found = compactErrors({
            email: emailError(email),
            password: password.length < PASSWORD_MIN ? `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres.` : undefined,
          });
          setErrors(found);
          if (Object.keys(found).length > 0) {
            focusFirstInvalid(formRef.current);
            return;
          }
          register.mutate(
            { email: email.trim(), password, ...(name.trim() ? { displayName: name.trim() } : {}) },
            { onError: () => focusFirstInvalid(formRef.current) },
          );
        }}
      >
        <Field label="Correo" error={errors.email ?? fields.email} hint="Solo lo usás para entrar. No te vamos a mandar correos.">
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={160}
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
          error={errors.password ?? fields.password}
          hint={`Al menos ${PASSWORD_MIN} caracteres. Una frase de varias palabras es fácil de recordar y difícil de adivinar.`}
        >
          {(p) => (
            <>
              <PasswordInput
                id={p.id}
                aria-describedby={p.describedBy}
                invalid={p.invalid}
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN}
                maxLength={200}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  edited("password");
                }}
              />
              <StrengthMeter password={password} />
            </>
          )}
        </Field>
        <Field
          label="Tu nombre"
          optional
          error={fields.displayName}
          hint="Para el saludo y el menú. Tus alumnos también lo ven, en la pantalla de entrada de tus actividades."
        >
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                edited("displayName");
              }}
            />
          )}
        </Field>
        <FormError message={register.isError && !fields.email && !fields.password && !fields.displayName ? errorMessage(register.error) : null} />
        <div>
          <Button type="submit" loading={register.isPending}>
            Crear cuenta
          </Button>
        </div>
      </form>
    </div>
  );
}

function WithAccount({ me, onNewCode }: { me: Me; onNewCode: (code: string) => void }) {
  const [changing, setChanging] = useState(false);
  const [confirmCode, setConfirmCode] = useState(false);
  const newCode = useNewRecoveryCode();
  const logout = useLogout();
  const forget = useForgetWorkspace();
  const navigate = useNavigate();

  return (
    <div>
      <dl className="grid gap-1">
        <dt className="text-xs font-semibold text-text-3">Correo de la cuenta</dt>
        <dd className="flex flex-wrap items-center gap-2 text-[16px] font-semibold break-all text-text">
          <Mail className="size-4 shrink-0 text-text-3" aria-hidden="true" />
          {me.email}
          {me.google ? <Badge tone="ink">Con Google</Badge> : null}
        </dd>
      </dl>
      <p className="mt-2 text-sm leading-6 text-text-2">
        {me.hasPassword && me.google
          ? "Podés abrir tu espacio desde cualquier dispositivo con «Continuar con Google» o con este correo y tu contraseña."
          : me.google
            ? "Podés abrir tu espacio desde cualquier dispositivo con «Continuar con Google»."
            : "Podés abrir tu espacio desde cualquier dispositivo con este correo y tu contraseña."}
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {/* A Google-only account has no password to change: Google is how it signs in and recovers. */}
        {me.hasPassword ? (
          <>
            <Button variant="secondary" icon={<Lock className="size-4" />} onClick={() => setChanging(true)}>
              Cambiar contraseña
            </Button>
            <Button
              variant="secondary"
              className="h-auto min-h-11 py-2.5 whitespace-normal"
              icon={<KeyRound className="size-4 shrink-0" />}
              onClick={() => setConfirmCode(true)}
            >
              Generar un código de recuperación nuevo
            </Button>
          </>
        ) : null}
        <Button
          variant="ghost"
          icon={<LogOut className="size-4" />}
          loading={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: async () => {
                await navigate({ to: "/" });
                forget();
                toast.success("Sesión cerrada en este dispositivo");
              },
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        >
          Cerrar sesión
        </Button>
      </div>

      <ChangePasswordDialog open={changing} onOpenChange={setChanging} onNewCode={onNewCode} />
      <ConfirmDialog
        open={confirmCode}
        onOpenChange={setConfirmCode}
        variant="primary"
        title="¿Generar un código nuevo?"
        description={<p>El código de recuperación anterior deja de servir. El nuevo se muestra una sola vez.</p>}
        confirmLabel="Generar código"
        loading={newCode.isPending}
        onConfirm={() =>
          newCode.mutate(undefined, {
            onSuccess: (r) => {
              setConfirmCode(false);
              onNewCode(r.recoveryCode);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function ChangePasswordDialog({
  open,
  onOpenChange,
  onNewCode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onNewCode: (code: string) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<{ currentPassword?: string; newPassword?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);
  const change = useChangePassword();
  const fields = change.error instanceof ApiError ? change.error.fields : {};
  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      setErrors({});
      change.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const edited = (key: "currentPassword" | "newPassword") => {
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
    if (change.isError) change.reset();
  };
  const submit = () => {
    const found = compactErrors({
      currentPassword: current ? undefined : "Escribí tu contraseña actual.",
      newPassword: next.length < PASSWORD_MIN ? `La contraseña nueva tiene que tener al menos ${PASSWORD_MIN} caracteres.` : undefined,
    });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid(formRef.current);
      return;
    }
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: (r) => {
          toast.success("Contraseña cambiada", { description: "Cerramos la sesión en tus otros dispositivos y generamos un código de recuperación nuevo." });
          onOpenChange(false);
          onNewCode(r.recoveryCode);
        },
        onError: () => focusFirstInvalid(formRef.current),
      },
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cambiar contraseña"
      description="Al cambiarla se cierra la sesión en tus otros dispositivos y el código de recuperación anterior deja de servir: te mostramos uno nuevo."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={change.isPending} onClick={submit}>
            Cambiar contraseña
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Contraseña actual" error={errors.currentPassword ?? fields.currentPassword}>
          {(p) => (
            <PasswordInput
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                edited("currentPassword");
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
                maxLength={200}
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  edited("newPassword");
                }}
              />
              <StrengthMeter password={next} />
            </>
          )}
        </Field>
        <FormError message={change.isError && !fields.currentPassword && !fields.newPassword ? errorMessage(change.error) : null} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
