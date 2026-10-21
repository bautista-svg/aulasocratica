import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog } from "@client/components/ui/dialog";
import { Button, buttonClass } from "@client/components/ui/button";
import { Field, FormError, Select } from "@client/components/ui/field";
import { Badge, Skeleton } from "@client/components/ui/misc";
import { cn } from "@client/lib/cn";
import { errorMessage } from "@client/lib/api";
import { fmtRelative } from "@client/lib/format";
import { useClassrooms } from "@client/features/classrooms/api";
import { classroomLabel } from "@shared/contracts/classrooms";
import type { MaterialSummary } from "@shared/contracts/materials";
import { useActivitiesOf, useMaterialMutations } from "./api";

const STATUS: Record<string, { label: string; tone: "neutral" | "leaf" | "amber" }> = {
  draft: { label: "Borrador", tone: "neutral" },
  published: { label: "Publicada", tone: "leaf" },
  archived: { label: "Archivada", tone: "amber" },
};

/** Copies a library material into an existing activity (classroom → activity). */
export function AttachDialog({ material, onOpenChange }: { material: MaterialSummary | null; onOpenChange: (o: boolean) => void }) {
  const open = material !== null;
  const rooms = useClassrooms(false);
  const [classroomId, setClassroomId] = useState("");
  const [activityId, setActivityId] = useState("");
  const acts = useActivitiesOf(classroomId);
  const mut = useMaterialMutations();
  const navigate = useNavigate();
  const groupName = useId();

  useEffect(() => {
    if (open) {
      setActivityId("");
      mut.attach.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, material?.id]);
  useEffect(() => {
    if (open && !classroomId && rooms.data?.length === 1) setClassroomId(rooms.data[0]!.id);
  }, [open, rooms.data, classroomId]);

  const attach = () => {
    if (!material || !activityId) return;
    const act = acts.data?.find((a) => a.id === activityId);
    mut.attach.mutate(
      { id: material.id, activityId },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          toast.success(`«${material.title}» se agregó a «${act?.title ?? "la actividad"}»`, {
            description:
              r.attachedAs === "file"
                ? r.processing
                  ? "Se copió como archivo y se termina de leer en unos minutos."
                  : "Se copió como archivo de la actividad."
                : "Se sumó al final del material escrito de la actividad.",
            action: { label: "Ver actividad", onClick: () => void navigate({ to: "/app/actividades/$activityId", params: { activityId: r.activityId } }) },
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Usar en una actividad"
      description={
        material
          ? material.kind === "file"
            ? "La actividad recibe una copia del archivo: si después lo borrás de Mis materiales, la actividad lo conserva."
            : "El texto se suma al final del material escrito de la actividad, sin borrar lo que ya tiene."
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={mut.attach.isPending} disabled={!activityId} onClick={attach}>
            Agregar a la actividad
          </Button>
        </>
      }
    >
      {rooms.isPending ? (
        <Skeleton className="h-11 w-full" />
      ) : rooms.isError ? (
        <FormError message={errorMessage(rooms.error)} />
      ) : rooms.data.length === 0 ? (
        <p className="rounded-md bg-sunken px-4 py-3 text-sm leading-6 text-text-2">
          Todavía no tenés aulas.{" "}
          <Link to="/app/aulas" onClick={() => onOpenChange(false)} className={buttonClass("ghost", "sm", "h-auto px-1 py-0 text-lilac-ink underline underline-offset-4")}>
            Crear un aula
          </Link>
        </p>
      ) : (
        <div className="grid gap-4">
          <Field label="Aula">
            {(p) => (
              <Select
                id={p.id}
                aria-describedby={p.describedBy}
                value={classroomId}
                onChange={(e) => {
                  setClassroomId(e.target.value);
                  setActivityId("");
                }}
              >
                <option value="">Elegí un aula</option>
                {rooms.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {classroomLabel(r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {classroomId ? (
            acts.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : acts.isError ? (
              <FormError message={errorMessage(acts.error)} />
            ) : acts.data.length === 0 ? (
              <p className="rounded-md bg-sunken px-4 py-3 text-sm leading-6 text-text-2">
                Esta aula todavía no tiene actividades.{" "}
                <Link
                  to="/app/aulas/$classroomId"
                  params={{ classroomId }}
                  onClick={() => onOpenChange(false)}
                  className={buttonClass("ghost", "sm", "h-auto px-1 py-0 text-lilac-ink underline underline-offset-4")}
                >
                  Ir al aula
                </Link>
              </p>
            ) : (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-text">Actividad</legend>
                <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
                  {acts.data.map((a) => (
                    <label
                      key={a.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lilac-ink",
                        activityId === a.id ? "border-ink bg-ink-soft/60" : "border-line-strong hover:border-ink/40",
                      )}
                    >
                      <input type="radio" name={groupName} value={a.id} checked={activityId === a.id} onChange={() => setActivityId(a.id)} className="size-4 accent-[var(--color-ink)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-text">{a.title}</span>
                        <span className="block text-[13px] text-text-3">Editada {fmtRelative(a.updatedAt)}</span>
                      </span>
                      <Badge tone={STATUS[a.status]?.tone ?? "neutral"}>{STATUS[a.status]?.label ?? a.status}</Badge>
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          ) : null}
          <FormError message={mut.attach.isError ? errorMessage(mut.attach.error) : null} />
        </div>
      )}
    </Dialog>
  );
}
