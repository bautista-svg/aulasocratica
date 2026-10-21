// Confirmations for the activity menu: unpublish, duplicate, reset, archive and delete.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@client/components/ui/button";
import { Checkbox } from "@client/components/ui/controls";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Field, FormError, Select } from "@client/components/ui/field";
import { errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { useClassrooms } from "@client/features/classrooms/api";
import type { ActivityEditorData } from "@shared/contracts/activities";
import { activityKeys, useActivityAction, useDeleteActivity, useDuplicateActivity, useResetActivity } from "./api";

export type LifecycleDialog = "unpublish" | "duplicate" | "reset" | "archive" | "delete" | null;

export function LifecycleDialogs({
  activity,
  open,
  onClose,
  onLeave,
}: {
  activity: ActivityEditorData;
  open: LifecycleDialog;
  onClose: () => void;
  /** Called right before navigating away because the activity no longer exists. */
  onLeave?: () => void;
}) {
  const navigate = useNavigate();
  const action = useActivityAction(activity.id);
  const reset = useResetActivity(activity.id);
  const del = useDeleteActivity(activity.id);
  const [newLink, setNewLink] = useState(false);
  const work = plural(activity.participants, "alumno", "alumnos");

  const qc = useQueryClient();
  useEffect(() => {
    if (open === "reset") setNewLink(false);
    // Fresh participant counts for the confirmation texts.
    if (open === "reset" || open === "delete") void qc.invalidateQueries({ queryKey: activityKeys.one(activity.id), exact: true });
  }, [open, qc, activity.id]);

  return (
    <>
      <ConfirmDialog
        open={open === "unpublish"}
        onOpenChange={(o) => !o && onClose()}
        variant="primary"
        title="¿Volver a borrador?"
        description={
          <>
            <p>Mientras sea borrador, tus alumnos no pueden entrar ni seguir trabajando: si alguien está escribiendo ahora, no va a poder continuar.</p>
            <p>Lo que ya hicieron se conserva. Cuando la publiques de nuevo, el enlace vuelve a funcionar.</p>
          </>
        }
        confirmLabel="Volver a borrador"
        loading={action.isPending}
        onConfirm={() =>
          action.mutate("unpublish", {
            onSuccess: () => {
              onClose();
              toast.success("La actividad volvió a borrador");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />

      <ConfirmDialog
        open={open === "archive"}
        onOpenChange={(o) => !o && onClose()}
        variant="primary"
        title="¿Archivar esta actividad?"
        description={
          <>
            <p>Deja de recibir alumnos y quien esté trabajando no puede seguir. El trabajo hecho y la configuración se conservan.</p>
            <p>Podés restaurarla cuando quieras (vuelve como borrador).</p>
          </>
        }
        confirmLabel="Archivar"
        loading={action.isPending}
        onConfirm={() =>
          action.mutate("archive", {
            onSuccess: () => {
              onClose();
              toast.success("Actividad archivada");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />

      <ConfirmDialog
        open={open === "reset"}
        onOpenChange={(o) => !o && onClose()}
        title="¿Reiniciar la actividad?"
        description={
          <>
            {activity.participants > 0 ? (
              <p>
                Se borra para siempre el trabajo de <strong className="text-text">{work}</strong> en esta actividad: respuestas, conversaciones con el tutor,
                evaluaciones, resúmenes y alertas.
              </p>
            ) : (
              <p>Todavía nadie trabajó en esta actividad, así que no hay trabajos para borrar.</p>
            )}
            <p>
              Se conservan la consigna, el material, los archivos, el tutor, la rúbrica y el enlace. Los alumnos que entraron solos por el enlace y no tienen otros
              trabajos en el aula también se quitan de la lista del aula.
            </p>
            <div className="pt-1">
              <Checkbox
                checked={newLink}
                onCheckedChange={setNewLink}
                label="Generar también un enlace nuevo"
                description="El enlace y el QR actuales dejan de funcionar."
              />
            </div>
          </>
        }
        confirmLabel="Reiniciar actividad"
        typeToConfirm="REINICIAR"
        loading={reset.isPending}
        onConfirm={() =>
          reset.mutate(
            { regenerateLink: newLink },
            {
              onSuccess: (r) => {
                onClose();
                toast.success(
                  r.deleted.sessions > 0
                    ? `Actividad reiniciada: se borró el trabajo de ${plural(r.deleted.sessions, "alumno", "alumnos")}${r.linkRegenerated ? " y hay un enlace nuevo" : ""}.`
                    : `Actividad reiniciada${r.linkRegenerated ? ": hay un enlace nuevo" : ""}.`,
                );
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />

      <ConfirmDialog
        open={open === "delete"}
        onOpenChange={(o) => !o && onClose()}
        title="¿Eliminar esta actividad para siempre?"
        description={
          <>
            <p>
              Se borran la actividad, su enlace, sus archivos{activity.participants > 0 ? <> y el trabajo de <strong className="text-text">{work}</strong></> : null}.
            </p>
            <p className="font-semibold text-text">No se puede deshacer. Si solo querés que no reciba alumnos, archivala.</p>
          </>
        }
        confirmLabel="Eliminar para siempre"
        typeToConfirm="BORRAR"
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(undefined, {
            onSuccess: (r) => {
              toast.success("Actividad eliminada");
              onClose();
              onLeave?.();
              void navigate({ to: "/app/aulas/$classroomId", params: { classroomId: r.classroomId } });
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />

      <DuplicateDialog activity={activity} open={open === "duplicate"} onClose={onClose} />
    </>
  );
}

function DuplicateDialog({ activity, open, onClose }: { activity: ActivityEditorData; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const rooms = useClassrooms(false);
  const dup = useDuplicateActivity(activity.id);
  const [target, setTarget] = useState(activity.classroomId);
  useEffect(() => {
    if (open) {
      setTarget(activity.classroomId);
      dup.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const options = rooms.data ?? [];
  const hasCurrent = options.some((r) => r.id === activity.classroomId);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Duplicar actividad"
      description="Se crea un borrador con la misma configuración, el material y copias de los archivos. No se copia el trabajo de los alumnos."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={dup.isPending}
            onClick={() =>
              dup.mutate(target, {
                onSuccess: (r) => {
                  onClose();
                  toast.success(r.skippedFiles ? `Actividad duplicada. ${plural(r.skippedFiles, "archivo no se pudo", "archivos no se pudieron")} copiar.` : "Actividad duplicada");
                  void navigate({ to: "/app/actividades/$activityId", params: { activityId: r.activity.id }, search: { tab: "configuracion" } });
                },
              })
            }
          >
            Duplicar
          </Button>
        </>
      }
    >
      <Field label="Aula de la copia" hint="Podés duplicarla en otra de tus aulas.">
        {(p) => (
          <Select id={p.id} aria-describedby={p.describedBy} value={target} onChange={(e) => setTarget(e.target.value)} disabled={rooms.isPending}>
            {!hasCurrent ? <option value={activity.classroomId}>{activity.classroomName}</option> : null}
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.id === activity.classroomId ? " (esta aula)" : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {rooms.isError ? <p className="mt-2 text-[13px] text-text-3">No se pudo cargar la lista de aulas; se duplica en esta aula.</p> : null}
      <div className="mt-4">
        <FormError message={dup.isError ? errorMessage(dup.error) : null} />
      </div>
    </Dialog>
  );
}
