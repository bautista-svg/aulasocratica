// "Compartir aula": who has access (the owner, "Titular", and each member with their role) and,
// for who manages the classroom, one-time invitation links by role and the pending ones.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link2, LogOut, UserMinus } from "lucide-react";
import { Dialog, ConfirmDialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { CopyButton } from "@client/components/ui/controls";
import { Badge, ErrorState, Skeleton } from "@client/components/ui/misc";
import { FormError, Select } from "@client/components/ui/field";
import { errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import { fmtDate } from "@client/lib/format";
import { RadioCards } from "@client/features/activities/parts";
import { can, INVITE_DAYS, MEMBER_ROLES, ROLE_INFO, ROLE_LABEL, type ClassroomRole, type MemberRole } from "@shared/domain/sharing";
import type { ClassroomSharing, InviteCreated, SharingPerson } from "@shared/contracts/sharing";
import { useSharing, useSharingMutations } from "./api";

const ROLE_OPTIONS = MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r], description: ROLE_INFO[r] }));

/** Up to two initials, for the round marker next to each name. */
function initials(name: string): string {
  const words = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

function Person({ person, owner, children }: { person: SharingPerson; owner?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full font-display text-[15px] font-semibold",
            owner ? "bg-ink text-white" : "bg-lilac-soft text-lilac-ink",
          )}
        >
          {initials(person.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-text">
            {person.name}
            {person.isMe ? <span className="font-normal text-text-3"> (vos)</span> : null}
          </p>
          {person.email && person.email !== person.name ? <p className="truncate text-[13px] text-text-3">{person.email}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pl-[52px] sm:pl-0">{children}</div>
    </li>
  );
}

export function ShareDialog({
  classroomId,
  classroomName,
  open,
  onOpenChange,
  onLeave,
}: {
  classroomId: string;
  classroomName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** A member asks to stop seeing the classroom (the page confirms and leaves). */
  onLeave: () => void;
}) {
  const q = useSharing(classroomId, open);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Compartir aula"
      description={`Sumá a otros docentes a «${classroomName}» con un enlace. Cada uno ve y hace lo que le permite su rol.`}
    >
      {q.isPending ? (
        <div className="grid gap-3 py-2" aria-busy="true" aria-label="Cargando">
          <Skeleton className="h-10 w-3/5" />
          <Skeleton className="h-10 w-2/5" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <ShareBody classroomId={classroomId} data={q.data} onLeave={onLeave} />
      )}
    </Dialog>
  );
}

function ShareBody({ classroomId, data, onLeave }: { classroomId: string; data: ClassroomSharing; onLeave: () => void }) {
  const manage = can(data.myRole, "manage");
  const m = useSharingMutations(classroomId);
  const [removing, setRemoving] = useState<SharingPerson | null>(null);
  const onError = (e: unknown) => toast.error(errorMessage(e));

  return (
    <div className="grid gap-6">
      <section aria-labelledby="share-people">
        <h3 id="share-people" className="text-sm font-semibold text-text">
          Con acceso
        </h3>
        <ul className="mt-1 divide-y divide-line">
          <Person person={data.owner} owner>
            <Badge tone="ink">{ROLE_LABEL.owner}</Badge>
          </Person>
          {data.members.map((p) => (
            <Person key={p.teacherId} person={p}>
              {manage ? (
                <>
                  <label className="sr-only" htmlFor={`role-${p.teacherId}`}>
                    Rol de {p.name}
                  </label>
                  <Select
                    id={`role-${p.teacherId}`}
                    value={p.role}
                    className="h-11 w-[132px] text-sm"
                    disabled={m.changeRole.isPending && m.changeRole.variables?.teacherId === p.teacherId}
                    onChange={(e) =>
                      m.changeRole.mutate(
                        { teacherId: p.teacherId, role: e.target.value as MemberRole },
                        { onSuccess: () => toast.success(`${p.name} ahora es ${ROLE_LABEL[e.target.value as MemberRole]}`), onError },
                      )
                    }
                  >
                    {MEMBER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                  {p.isMe ? null : (
                    <Button variant="ghost" size="icon" aria-label={`Quitar a ${p.name}`} className="text-text-2 hover:text-rose" onClick={() => setRemoving(p)}>
                      <UserMinus className="size-4" />
                    </Button>
                  )}
                </>
              ) : (
                <Badge tone="lilac">{ROLE_LABEL[p.role]}</Badge>
              )}
            </Person>
          ))}
        </ul>
        {data.members.length === 0 ? <p className="text-sm text-text-3">Todavía no la compartiste con nadie.</p> : null}
      </section>

      {manage ? <InviteSection classroomId={classroomId} data={data} /> : <RolesHelp role={data.myRole} />}

      {data.myRole !== "owner" ? (
        <div className="flex flex-col gap-2 rounded-md border border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] leading-5 text-text-2">Si ya no la necesitás, deja de aparecer en tus aulas. Para volver, te tienen que invitar de nuevo.</p>
          <Button variant="secondary" size="sm" icon={<LogOut className="size-4" />} className="shrink-0" onClick={onLeave}>
            Dejar de ver esta aula
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`¿Quitar a ${removing?.name ?? ""} del aula?`}
        description={<p>Deja de ver el aula y el trabajo de sus alumnos. Lo que hizo en las actividades queda en el aula.</p>}
        confirmLabel="Quitar del aula"
        loading={m.remove.isPending}
        onConfirm={() => {
          if (!removing) return;
          m.remove.mutate(removing.teacherId, {
            onSuccess: () => {
              toast.success(`${removing.name} ya no tiene acceso`);
              setRemoving(null);
            },
            onError,
          });
        }}
      />
    </div>
  );
}

/** What each role can do, for members who cannot invite (so they know why some buttons are missing). */
function RolesHelp({ role }: { role: ClassroomRole }) {
  if (role === "owner") return null;
  return (
    <p className="rounded-md bg-paper px-4 py-3 text-[13px] leading-5 text-text-2">
      <span className="font-semibold text-text">Tu rol: {ROLE_LABEL[role]}.</span> {ROLE_INFO[role as MemberRole]} Para sumar a otros docentes, pedíselo a
      quien creó el aula o a un admin.
    </p>
  );
}

function InviteSection({ classroomId, data }: { classroomId: string; data: ClassroomSharing }) {
  const m = useSharingMutations(classroomId);
  const [role, setRole] = useState<MemberRole>("editor");
  const [created, setCreated] = useState<InviteCreated | null>(null);
  // A new role choice hides the previous link: it belongs to the role it was created with.
  useEffect(() => setCreated(null), [role]);
  const url = created ? `${window.location.origin}/invitacion/${created.token}` : "";

  return (
    <>
      <section aria-labelledby="share-invite" className="rounded-lg border border-line bg-paper/60 p-4">
        <h3 id="share-invite" className="flex items-center gap-2 text-sm font-semibold text-text">
          <Link2 className="size-4 text-lilac-ink" aria-hidden="true" />
          Invitar con un enlace
        </h3>
        <p className="mt-0.5 mb-3 text-[13px] leading-5 text-text-2">
          Sirve una sola vez y vence a los {INVITE_DAYS} días. Quien lo abre necesita una cuenta (con Google o con su correo).
        </p>
        <RadioCards name="invite-role" legend="Rol" value={role} onChange={setRole} options={ROLE_OPTIONS} />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            loading={m.createInvite.isPending}
            onClick={() => m.createInvite.mutate(role, { onSuccess: (r) => setCreated(r) })}
            icon={<Link2 className="size-4" />}
          >
            Crear enlace de invitación
          </Button>
        </div>
        <FormError message={m.createInvite.isError ? errorMessage(m.createInvite.error) : null} />
        {created ? (
          <div role="status" className="mt-3 rounded-md border border-dashed border-lilac bg-surface p-3">
            <p className="text-[13px] font-semibold text-lilac-ink">Enlace para {ROLE_LABEL[created.invite.role]}</p>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 rounded-sm bg-paper px-2.5 py-2 font-mono text-[13px] break-all text-text">{url}</code>
              <CopyButton value={url} label="Copiar enlace" variant="primary" className="shrink-0" />
            </div>
            <p className="mt-2 text-[13px] leading-5 text-text-2">
              Copialo ahora y mandalo por donde quieras: por seguridad no se vuelve a mostrar. Vence el {fmtDate(created.invite.expiresAt)}.
            </p>
          </div>
        ) : null}
      </section>

      {data.invites.length ? (
        <section aria-labelledby="share-pending">
          <h3 id="share-pending" className="text-sm font-semibold text-text">
            Enlaces sin usar
          </h3>
          <ul className="mt-1 divide-y divide-line">
            {data.invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <Badge tone="lilac">{ROLE_LABEL[i.role]}</Badge>
                <p className="min-w-0 flex-1 text-[13px] leading-5 text-text-2">
                  Lo creó {i.createdByName} · vence el {fmtDate(i.expiresAt)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-rose"
                  loading={m.revokeInvite.isPending && m.revokeInvite.variables === i.id}
                  onClick={() =>
                    m.revokeInvite.mutate(i.id, {
                      onSuccess: () => toast.success("Enlace anulado: ya no sirve para entrar"),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  Anular
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
