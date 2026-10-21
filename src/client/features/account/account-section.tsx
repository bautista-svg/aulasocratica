import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { KeyRound, LogOut, Lock, Mail, Smartphone } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Dialog, ConfirmDialog } from "@client/components/ui/dialog";
import { Field, FormError, Input } from "@client/components/ui/field";
import { ApiError, errorMessage } from "@client/lib/api";
import type { Me } from "@shared/contracts/auth";
import { useChangePassword, useForgetWorkspace, useLogout, useNewRecoveryCode, useRegister } from "./api";
import { PasswordInput, PASSWORD_MIN, StrengthMeter } from "./password-input";
import { RecoveryCodePanel } from "./recovery-code-panel";

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
  const register = useRegister((r) => {
    toast.success("Cuenta creada");
    onCreated(r.recoveryCode);
  });
  const fields = register.error instanceof ApiError ? register.error.fields : {};
  useEffect(() => setName((n) => n || me.displayName), [me.displayName]);

  return (
    <div>
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
        Con un correo y una contraseña podés abrir este mismo espacio desde cualquier dispositivo. No se pierde nada de lo que ya hiciste.
      </p>
      <form
        className="mt-4 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate({ email: email.trim(), password, ...(name.trim() ? { displayName: name.trim() } : {}) });
        }}
      >
        <Field label="Correo" error={fields.email} hint="Solo lo usás para entrar. No te vamos a mandar correos.">
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
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Contraseña"
          error={fields.password}
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
                onChange={(e) => setPassword(e.target.value)}
              />
              <StrengthMeter password={password} />
            </>
          )}
        </Field>
        <Field label="Tu nombre" optional error={fields.displayName} hint="Para el saludo y el menú. Tus alumnos no lo ven.">
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <FormError message={register.isError && !fields.email && !fields.password ? errorMessage(register.error) : null} />
        <div>
          <Button type="submit" loading={register.isPending} disabled={!email.trim() || password.length < PASSWORD_MIN}>
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
        <dd className="flex items-center gap-2 text-[16px] font-semibold break-all text-text">
          <Mail className="size-4 shrink-0 text-text-3" aria-hidden="true" />
          {me.email}
        </dd>
      </dl>
      <p className="mt-2 text-sm leading-6 text-text-2">Podés abrir tu espacio desde cualquier dispositivo con este correo y tu contraseña.</p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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

      <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
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

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useChangePassword();
  const fields = change.error instanceof ApiError ? change.error.fields : {};
  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      change.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = () =>
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast.success("Contraseña cambiada", { description: "Cerramos la sesión en tus otros dispositivos." });
          onOpenChange(false);
        },
      },
    );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cambiar contraseña"
      description="Al cambiarla se cierra la sesión en tus otros dispositivos."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={change.isPending} disabled={!current || next.length < PASSWORD_MIN} onClick={submit}>
            Cambiar contraseña
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (current && next.length >= PASSWORD_MIN) submit();
        }}
      >
        <Field label="Contraseña actual" error={fields.currentPassword}>
          {(p) => (
            <PasswordInput
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field label="Contraseña nueva" error={fields.newPassword} hint={`Al menos ${PASSWORD_MIN} caracteres.`}>
          {(p) => (
            <>
              <PasswordInput
                id={p.id}
                aria-describedby={p.describedBy}
                invalid={p.invalid}
                autoComplete="new-password"
                maxLength={200}
                value={next}
                onChange={(e) => setNext(e.target.value)}
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
