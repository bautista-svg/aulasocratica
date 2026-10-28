// "Compartir aula": who has access (the owner, "Titular", and each member with their role) and,
// for who manages the classroom, one-time invitation links by role and the pending ones.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Link2, LogOut, Plus, Share2, UserMinus } from "lucide-react";
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
        <ShareBody classroomId={classroomId} classroomName={classroomName} data={q.data} onLeave={onLeave} />
      )}
    </Dialog>
  );
}

function ShareBody({ classroomId, classroomName, data, onLeave }: { classroomId: string; classroomName: string; data: ClassroomSharing; onLeave: () => void }) {
  const manage = can(data.myRole, "manage");
  const m = useSharingMutations(classroomId);
  const [removing, setRemoving] = useState<SharingPerson | null>(null);
  const onError = (e: unknown) => toast.error(errorMessage(e));

  return (
    <div className="grid gap-6">
      {/* Inviting comes first: on a phone it is what the dialog is opened for. */}
      {manage ? <InviteSection classroomId={classroomId} classroomName={classroomName} data={data} /> : null}

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

      {manage ? null : <RolesHelp role={data.myRole} />}

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

function InviteSection({ classroomId, classroomName, data }: { classroomId: string; classroomName: string; data: ClassroomSharing }) {
  const m = useSharingMutations(classroomId);
  const [role, setRole] = useState<MemberRole>("editor");
  const [created, setCreated] = useState<InviteCreated | null>(null);
  const url = created ? `${window.location.origin}/invitacion/${created.token}` : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  // On a phone the link (or the error) appears below the fold of the dialog: bring it into view
  // and give it the focus, so creating the link never looks like nothing happened.
  const resultRef = useRef<HTMLDivElement | null>(null);
  const failed = m.createInvite.isError;
  useEffect(() => {
    if (!created && !failed) return;
    const el = resultRef.current;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  }, [created, failed]);

  async function share() {
    try {
      await navigator.share({
        title: `Aula «${classroomName}»`,
        text: `Te invito como ${ROLE_LABEL[created!.invite.role]} al aula «${classroomName}» en Aula Socrática.`,
        url,
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error("No se pudo abrir el menú para compartir. Copiá el enlace.");
    }
  }

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
        {created ? (
          <div ref={resultRef} tabIndex={-1} role="status" className="rounded-md border border-lilac/60 bg-surface p-3.5 shadow-1 outline-none">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-lilac-ink">
              <Check className="size-4" aria-hidden="true" />
              Listo: enlace para {ROLE_LABEL[created.invite.role]}
            </p>
            <code className="mt-2 block rounded-sm bg-paper px-2.5 py-2 font-mono text-[13px] break-all text-text">{url}</code>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {canShare ? (
                <Button size="sm" icon={<Share2 className="size-4" />} onClick={() => void share()}>
                  Compartir
                </Button>
              ) : null}
              <CopyButton value={url} label="Copiar enlace" variant={canShare ? "secondary" : "primary"} />
            </div>
            <p className="mt-2.5 text-[13px] leading-5 text-text-2">
              Mandalo ahora (por WhatsApp, correo…): por seguridad no se vuelve a mostrar. Vence el {fmtDate(created.invite.expiresAt)}.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 -ml-2 text-lilac-ink"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setCreated(null);
                m.createInvite.reset();
              }}
            >
              Crear otro enlace
            </Button>
          </div>
        ) : (
          <>
            <RadioCards name="invite-role" legend="Rol" value={role} onChange={setRole} options={ROLE_OPTIONS} />
            <Button
              className="mt-3 w-full sm:w-auto"
              loading={m.createInvite.isPending}
              onClick={() => m.createInvite.mutate(role, { onSuccess: (r) => setCreated(r) })}
              icon={<Link2 className="size-4" />}
            >
              Crear enlace de invitación
            </Button>
            {failed ? (
              <div ref={resultRef} tabIndex={-1} className="mt-3 outline-none">
                <FormError message={errorMessage(m.createInvite.error)} />
              </div>
            ) : null}
          </>
        )}
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
