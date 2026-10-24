// Actions on an activity from the classroom list ("···": edit, duplicate, delete) and the
// classroom's "Papelera", where deleted activities wait 30 days and can be restored.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArchiveRestore, ChevronDown, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Menu } from "@client/components/ui/controls";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { api, errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import { fmtDate, fmtRelative, plural } from "@client/lib/format";
import { classroomKeys } from "@client/features/classrooms/api";
import { TRASH_DAYS, type TrashedActivity } from "@shared/contracts/activities";
import { activityKeys, forgetActivity } from "./api";
import { DuplicateDialog, type DuplicateSource } from "./lifecycle-dialogs";

export interface RowActivity {
  id: string;
  title: string;
  participants: number;
  classroomId: string;
}

const trashKey = (classroomId: string) => [...classroomKeys.one(classroomId), "trash"] as const;

function refreshClassroom(qc: ReturnType<typeof useQueryClient>, classroomId: string, activityId: string) {
  void qc.invalidateQueries({ queryKey: classroomKeys.one(classroomId) });
  void qc.invalidateQueries({ queryKey: activityKeys.one(activityId), exact: true });
  void qc.invalidateQueries({ queryKey: ["dashboard"] });
  void qc.invalidateQueries({ queryKey: ["alerts"] });
}

/** "Eliminar actividad": to the classroom's "Papelera" (recoverable for 30 days). */
export function useTrashActivity(a: RowActivity) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true; classroomId: string }>(`/api/activities/${a.id}/trash`),
    onSuccess: () => refreshClassroom(qc, a.classroomId, a.id),
  });
}

export function TrashActivityDialog({ activity, open, onClose, onTrashed }: { activity: RowActivity | null; open: boolean; onClose: () => void; onTrashed?: () => void }) {
  const trash = useTrashActivity(activity ?? { id: "", title: "", participants: 0, classroomId: "" });
  return (
    <ConfirmDialog
      open={open && Boolean(activity)}
      onOpenChange={(o) => !o && onClose()}
      title="¿Estás seguro de que querés eliminar esta actividad?"
      description={
        <>
          <p>Esta acción podría afectar la información asociada: deja de verse en el aula y sus alumnos ya no pueden entrar.</p>
          {activity && activity.participants > 0 ? (
            <p className="font-semibold text-text">
              Tiene el trabajo de {plural(activity.participants, "alumno", "alumnos")} (conversaciones, respuestas y evaluaciones). Se guarda junto con la
              actividad.
            </p>
          ) : null}
          <p>Queda {TRASH_DAYS} días en la papelera del aula: podés restaurarla en ese tiempo. Después se borra para siempre.</p>
        </>
      }
      confirmLabel="Eliminar actividad"
      loading={trash.isPending}
      onConfirm={() =>
        trash.mutate(undefined, {
          onSuccess: () => {
            toast.success(`«${activity?.title}» está en la papelera del aula`);
            onClose();
            onTrashed?.();
          },
          onError: (e) => toast.error(errorMessage(e)),
        })
      }
    />
  );
}

/** "···" on a row of the classroom list. */
export function ActivityRowMenu({ activity, room }: { activity: RowActivity; room: { name: string; isArchived: boolean } }) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"duplicate" | "trash" | null>(null);
  const source: DuplicateSource = { id: activity.id, classroomId: activity.classroomId, classroomName: room.name, classroomArchived: room.isArchived };
  return (
    <>
      <Menu
        trigger={
          <Button variant="ghost" size="icon" aria-label={`Opciones de «${activity.title}»`} className="text-text-2">
            <MoreHorizontal className="size-5" />
          </Button>
        }
        items={[
          {
            label: "Editar actividad",
            icon: <Pencil className="size-4" />,
            onSelect: () => void navigate({ to: "/app/actividades/$activityId", params: { activityId: activity.id }, search: { tab: "configuracion" } }),
          },
          { label: "Duplicar actividad", icon: <Copy className="size-4" />, onSelect: () => setDialog("duplicate") },
          "separator",
          { label: "Eliminar actividad", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDialog("trash") },
        ]}
      />
      <DuplicateDialog activity={source} open={dialog === "duplicate"} onClose={() => setDialog(null)} />
      <TrashActivityDialog activity={activity} open={dialog === "trash"} onClose={() => setDialog(null)} />
    </>
  );
}

/** The classroom's "Papelera": restore, or remove for good before the 30 days. */
export function TrashSection({ classroomId }: { classroomId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [purging, setPurging] = useState<TrashedActivity | null>(null);
  const q = useQuery({
    queryKey: trashKey(classroomId),
    queryFn: ({ signal }) => api.get<{ activities: TrashedActivity[] }>(`/api/classrooms/${classroomId}/trash`, signal),
    select: (d) => d.activities,
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/api/activities/${id}/untrash`),
    onSuccess: (_r, id) => {
      refreshClassroom(qc, classroomId, id);
      toast.success("Actividad restaurada como borrador. Publicala para que tus alumnos vuelvan a entrar.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const purge = useMutation({
    mutationFn: (id: string) => api.del(`/api/activities/${id}`, { confirm: "BORRAR" }),
    onSuccess: (_r, id) => {
      forgetActivity(qc, id);
      void qc.invalidateQueries({ queryKey: trashKey(classroomId) });
      toast.success("Actividad eliminada para siempre");
      setPurging(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = q.data ?? [];
  if (!list.length) return null;
  return (
    <section className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface/60" aria-labelledby="papelera-title">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lilac-ink"
      >
        <Trash2 className="size-4 text-text-3" aria-hidden="true" />
        <span id="papelera-title" className="flex-1 font-semibold text-text-2">
          Papelera · {list.length}
        </span>
        <span className="hidden text-sm text-text-3 sm:inline">Se borran solas a los {TRASH_DAYS} días</span>
        <ChevronDown className={cn("size-4 text-text-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <ul className="divide-y divide-line border-t border-line">
          {list.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-text">{a.title}</p>
                <p className="text-sm text-text-3">
                  Eliminada {fmtRelative(a.deletedAt)} · se borra para siempre el {fmtDate(a.purgeAt)}
                  {a.participants ? ` · ${plural(a.participants, "alumno", "alumnos")}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ArchiveRestore className="size-4" />}
                  loading={restore.isPending && restore.variables === a.id}
                  onClick={() => restore.mutate(a.id)}
                >
                  Restaurar
                </Button>
                <Button size="sm" variant="ghost" className="text-rose" onClick={() => setPurging(a)}>
                  Eliminar para siempre
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={Boolean(purging)}
        onOpenChange={(o) => !o && setPurging(null)}
        title="¿Eliminar para siempre?"
        description={
          <>
            <p>
              Se borran «{purging?.title}», su enlace, sus archivos
              {purging?.participants ? <> y el trabajo de <strong className="text-text">{plural(purging.participants, "alumno", "alumnos")}</strong></> : null}.
            </p>
            <p className="font-semibold text-text">No se puede deshacer.</p>
          </>
        }
        confirmLabel="Eliminar para siempre"
        typeToConfirm="ELIMINAR"
        loading={purge.isPending}
        onConfirm={() => {
          if (purging) purge.mutate(purging.id);
        }}
      />
    </section>
  );
}
