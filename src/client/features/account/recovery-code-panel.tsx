import { useEffect, useId, useRef, useState } from "react";
import { Download, KeyRound } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Checkbox, CopyButton } from "@client/components/ui/controls";
import { LeaveGuard } from "./leave-guard";

/**
 * Shows a one-time recovery code. There is no outgoing email, so this code is the only way
 * back into the account if the password is forgotten: the teacher must confirm they saved it.
 */
export function RecoveryCodePanel({
  code,
  email,
  onDone,
  doneLabel = "Listo",
  title = "Guardá tu código de recuperación",
}: {
  code: string;
  email?: string | null;
  onDone: () => void;
  doneLabel?: string;
  title?: string;
}) {
  const [saved, setSaved] = useState(false);
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const download = () => {
    const text = [
      "Aula Socrática — código de recuperación",
      "",
      email ? `Cuenta: ${email}` : null,
      `Código: ${code}`,
      `Generado: ${new Date().toLocaleString("es-AR")}`,
      "",
      "Sirve una sola vez para crear una contraseña nueva si te olvidás la actual",
      "(en la pantalla Ingresar > Olvidé mi contraseña). Guardalo en un lugar seguro.",
    ]
      .filter((l) => l !== null)
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "aula-socratica-codigo-de-recuperacion.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="rounded-lg border-2 border-lilac-ink/40 bg-lilac-soft/60 p-5 outline-none sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-lilac-ink">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-xl font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-1 text-[15px] leading-6 text-text-2">
            No mandamos correos. Si te olvidás la contraseña, este código es la única forma de volver a entrar. Lo mostramos{" "}
            <strong className="text-text">una sola vez</strong>.
          </p>
        </div>
      </div>
      <p className="tabular mt-5 rounded-md border border-line bg-surface px-3 py-4 text-center font-mono text-[19px] font-semibold tracking-[0.06em] text-ink select-all min-[400px]:text-[22px] sm:text-2xl sm:tracking-[0.12em]">
        {code}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton value={code} label="Copiar código" copiedLabel="Código copiado" />
        <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={download}>
          Descargar .txt
        </Button>
      </div>
      <div className="mt-5 border-t border-lilac-ink/15 pt-4">
        <Checkbox
          checked={saved}
          onCheckedChange={setSaved}
          label="Lo guardé en un lugar seguro"
          description="Por ejemplo, en tu gestor de contraseñas o impreso."
        />
        <Button className="mt-4 w-full sm:w-auto" disabled={!saved} onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
      <LeaveGuard
        when={!saved}
        title="¿Ya guardaste el código?"
        description="Si salís sin guardarlo, no lo vas a poder ver de nuevo. Podés generar otro desde Mi espacio mientras tengas la sesión abierta."
        confirmLabel="Salir igual"
        cancelLabel="Volver al código"
      />
    </section>
  );
}
