import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { useDashboard } from "@client/features/dashboard/api";
import type { Me } from "@shared/contracts/auth";
import { useDeleteWorkspace, useForgetWorkspace } from "./api";

export function DeleteWorkspace({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const del = useDeleteWorkspace();
  const forget = useForgetWorkspace();
  const navigate = useNavigate();
  const counts = useDashboard().data?.counts;

  return (
    <>
      <Button
        variant="secondary"
        className="border-rose/40 text-rose hover:border-rose hover:bg-rose-soft"
        icon={<Trash2 className="size-4" />}
        onClick={() => setOpen(true)}
      >
        Borrar mi espacio
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Borrar tu espacio para siempre?"
        description={
          <>
            <p>Se borra todo lo que hay en este espacio:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                {counts && counts.classrooms > 0
                  ? `Tus ${plural(counts.classrooms, "aula activa", "aulas activas")} y las archivadas, con sus actividades y sus enlaces (que dejan de funcionar).`
                  : "Tus aulas (activas y archivadas), con sus actividades y sus enlaces (que dejan de funcionar)."}
              </li>
              <li>Los alumnos y todo su trabajo: respuestas, conversaciones con el tutor, rúbricas, alertas y radiografías.</li>
              <li>Tus tutores, tus materiales, los archivos que subiste y tus informes.</li>
              {me.hasAccount ? <li>Tu cuenta: el correo {me.email} y la contraseña dejan de servir.</li> : null}
            </ul>
            <p className="font-semibold text-text">
              No se puede deshacer. Si querés conservar algo, descargalo antes (por ejemplo, los informes en PDF).
            </p>
          </>
        }
        confirmLabel="Borrar para siempre"
        typeToConfirm="BORRAR"
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(undefined, {
            onSuccess: async () => {
              setOpen(false);
              await navigate({ to: "/" });
              forget();
              toast.success("Tu espacio se borró");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
