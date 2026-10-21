// Dialogs for actions on a student's work, shared by the live list and the session page.
import { Dialog, ConfirmDialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { CopyButton } from "@client/components/ui/controls";

export function ResumeCodeDialog({
  open,
  onOpenChange,
  studentName,
  code,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentName: string;
  code: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Código para continuar"
      description={`Si ${studentName} cambia de dispositivo o cerró la pestaña, puede seguir su trabajo con este código.`}
      footer={<Button onClick={() => onOpenChange(false)}>Listo</Button>}
    >
      <div className="flex flex-col items-center gap-4 py-4">
        <p className="tabular rounded-lg bg-sunken px-6 py-4 font-mono text-4xl font-semibold tracking-[0.25em] text-ink sm:text-5xl">
          {code}
        </p>
        <CopyButton value={code} label="Copiar código" />
        <p className="max-w-sm text-center text-sm text-text-2">Es personal: mostráselo solo a {studentName}.</p>
      </div>
    </Dialog>
  );
}

export function EndWorkDialog({
  open,
  onOpenChange,
  studentName,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentName: string;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`¿Terminar el trabajo de ${studentName}?`}
      description={
        <>
          <p>Se guarda lo que hizo hasta ahora y ya no puede seguir escribiendo.</p>
          <p>Si te arrepentís, desde su trabajo podés tocar «Permitir continuar».</p>
        </>
      }
      confirmLabel="Terminar"
      variant="primary"
      loading={loading}
      onConfirm={onConfirm}
    />
  );
}

export function DeleteWorkDialog({
  open,
  onOpenChange,
  studentName,
  activityTitle,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentName: string;
  activityTitle: string;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`¿Eliminar el trabajo de ${studentName}?`}
      description={
        <>
          <p>
            Se borran para siempre sus respuestas en «{activityTitle}», la conversación con el tutor, la evaluación, el resumen, la radiografía y
            las alertas de esta actividad.
          </p>
          <p>Sigue en la lista de alumnos del aula. Si vuelve a entrar con el enlace, empieza de cero.</p>
          <p className="font-semibold text-text">No se puede deshacer.</p>
        </>
      }
      confirmLabel="Eliminar trabajo"
      typeToConfirm="ELIMINAR"
      loading={loading}
      onConfirm={onConfirm}
    />
  );
}
