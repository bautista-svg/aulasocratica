// "Compartir" tab: the activity link, its QR (big enough to project), who can enter and
// when, and a new link when the old one leaked.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArchiveRestore, CalendarClock, Download, Expand, Link2, RefreshCw, Send, Share2 } from "lucide-react";
import { Button, buttonClass } from "@client/components/ui/button";
import { CopyButton, Switch } from "@client/components/ui/controls";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Field, Input } from "@client/components/ui/field";
import { Badge, Card, Notice, Skeleton } from "@client/components/ui/misc";
import { ApiError, errorMessage } from "@client/lib/api";
import { fmtDateTime, fromLocalInput, toLocalInput } from "@client/lib/format";
import { activityState } from "@shared/domain/activity-state";
import { linkAvailability } from "@shared/domain/access-rules";
import type { ActivityEditorData } from "@shared/contracts/activities";
import { useActivityAction, useUpdateLink } from "./api";

export function activityUrl(token: string) {
  return `${window.location.origin}/clase/${token}`;
}

function availabilityText(a: ActivityEditorData): string {
  switch (linkAvailability(a, { classroomArchived: a.classroomArchived })) {
    case "available":
      return a.expiresAt ? `Los alumnos pueden entrar hasta el ${fmtDateTime(a.expiresAt)}.` : "Los alumnos pueden entrar y trabajar.";
    case "inactive":
      return "El enlace está cerrado: nadie puede entrar ni seguir trabajando hasta que lo vuelvas a abrir.";
    case "not_started":
      return `El enlace se abre el ${fmtDateTime(a.startsAt)}. Hasta entonces nadie puede entrar.`;
    case "expired":
      return `El enlace cerró el ${fmtDateTime(a.expiresAt)}. Cambiá el horario si querés volver a abrirlo.`;
    case "archived":
      return a.classroomArchived ? "El aula está archivada: sus actividades no reciben alumnos." : "La actividad está archivada.";
    default:
      return "La actividad todavía no está publicada.";
  }
}

export function SharePanel({
  activity,
  onPublish,
  publishing,
}: {
  activity: ActivityEditorData;
  onPublish: () => void;
  publishing: boolean;
}) {
  const action = useActivityAction(activity.id);

  if (activity.status === "archived") {
    return (
      <Card className="px-5 py-8 text-center">
        <ArchiveRestore className="mx-auto size-8 text-lilac" aria-hidden="true" />
        <h2 className="mt-3 font-display text-xl font-semibold text-ink">La actividad está archivada</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-text-2">El enlace no recibe alumnos. Restaurala como borrador y publicala para volver a compartirla.</p>
        <Button
          className="mt-5"
          icon={<ArchiveRestore className="size-4" />}
          loading={action.isPending}
          onClick={() =>
            action.mutate("restore", {
              onSuccess: () => toast.success("Actividad restaurada como borrador"),
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        >
          Restaurar
        </Button>
      </Card>
    );
  }

  if (activity.status !== "published") {
    return (
      <Card className="px-5 py-8 text-center">
        <Link2 className="mx-auto size-8 text-lilac" aria-hidden="true" />
        <h2 className="mt-3 font-display text-xl font-semibold text-ink">La actividad todavía es un borrador</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-text-2">
          Mientras sea borrador, el enlace no funciona. Revisá la consigna y el tutor, y publicala para compartir el enlace y el código QR con tus alumnos.
        </p>
        <Button className="mt-5" icon={<Send className="size-4" />} loading={publishing} onClick={onPublish}>
          Publicar
        </Button>
      </Card>
    );
  }

  return <PublishedShare activity={activity} />;
}

function PublishedShare({ activity }: { activity: ActivityEditorData }) {
  const url = activityUrl(activity.linkToken);
  const state = activityState(activity);
  const link = useUpdateLink(activity.id);
  const action = useActivityAction(activity.id);
  const [regenerating, setRegenerating] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function share() {
    try {
      await navigator.share({ title: activity.title, text: `${activity.title}: entrá con tu nombre y apellido.`, url });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error("No se pudo abrir el menú para compartir. Copiá el enlace.");
    }
  }

  return (
    // Same order on every screen (link, QR, the rest); on desktop the QR moves to a right column.
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <Card className="min-w-0 p-4 sm:p-5 lg:col-start-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">Enlace de la actividad</h2>
            <Badge tone={state.tone} dot={state.open}>
              {state.label}
            </Badge>
          </div>
          <p className="mt-1 text-sm leading-6 text-text-2" aria-live="polite">
            {availabilityText(activity)}
          </p>
          <label htmlFor="activity-url" className="mt-4 mb-1.5 block text-sm font-semibold text-text">
            Enlace para tus alumnos
          </label>
          <Input id="activity-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[14px]" />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <CopyButton value={url} label="Copiar enlace" copiedLabel="Enlace copiado" variant="primary" className="h-11 px-4 text-[15px]" />
            {canShare ? (
              <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={() => void share()}>
                Compartir…
              </Button>
            ) : null}
          </div>
        </Card>

        <QrCard url={url} title={activity.title} />

        <Card className="p-4 sm:p-5 lg:col-start-1">
          <Switch
            checked={activity.linkActive}
            disabled={link.isPending}
            onCheckedChange={(v) =>
              link.mutate(
                { linkActive: v },
                {
                  onSuccess: () => toast.success(v ? "El enlace acepta alumnos" : "El enlace quedó cerrado"),
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
            label="Aceptar alumnos"
            description={
              activity.linkActive
                ? "Apagalo para cerrar la actividad: nadie puede entrar ni seguir escribiendo hasta que lo vuelvas a prender. Lo que ya hicieron se conserva."
                : "Cerrado: nadie puede entrar ni seguir escribiendo. Prendelo para volver a abrir la actividad."
            }
          />
        </Card>

        <ScheduleCard activity={activity} />

        <Card className="p-4 sm:p-5 lg:col-start-1">
          <h2 className="font-display text-lg font-semibold text-ink">Cómo entran tus alumnos</h2>
          <ol className="mt-3 grid gap-2.5 text-sm leading-6 text-text-2">
            {[
              "Abren el enlace o escanean el código QR con el celular.",
              "Escriben su nombre y apellido. No necesitan cuenta, correo ni contraseña.",
              "Trabajan con el tutor y vos seguís su trabajo en la pestaña «En vivo».",
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-lilac-soft text-xs font-semibold text-lilac-ink" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-4 sm:p-5 lg:col-start-1">
          <h2 className="font-display text-lg font-semibold text-ink">¿Se compartió el enlace donde no debía?</h2>
          <p className="mt-1 text-sm leading-6 text-text-2">Generá uno nuevo: el anterior deja de funcionar para entrar. El trabajo de los alumnos no se borra.</p>
          <Button className="mt-3" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => setRegenerating(true)}>
            Generar un enlace nuevo
          </Button>
        </Card>

      <ConfirmDialog
        open={regenerating}
        onOpenChange={setRegenerating}
        title="¿Generar un enlace nuevo?"
        description={
          <>
            <p>El enlace y el código QR actuales dejan de funcionar: quien los abra no va a poder entrar. Vas a tener que compartir el nuevo.</p>
            <p>Lo que ya hicieron tus alumnos se conserva.</p>
          </>
        }
        confirmLabel="Generar enlace nuevo"
        loading={action.isPending}
        onConfirm={() =>
          action.mutate("link/regenerate", {
            onSuccess: () => {
              setRegenerating(false);
              toast.success("Enlace nuevo generado. El anterior ya no funciona.");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function ScheduleCard({ activity }: { activity: ActivityEditorData }) {
  const link = useUpdateLink(activity.id);
  const [startsAt, setStartsAt] = useState(toLocalInput(activity.startsAt));
  const [expiresAt, setExpiresAt] = useState(toLocalInput(activity.expiresAt));
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    setStartsAt(toLocalInput(activity.startsAt));
    setExpiresAt(toLocalInput(activity.expiresAt));
  }, [activity.startsAt, activity.expiresAt]);
  const zone = useMemo(() => {
    const off = -new Date().getTimezoneOffset();
    const h = Math.trunc(Math.abs(off) / 60);
    const m = Math.abs(off) % 60;
    return `UTC${off < 0 ? "−" : "+"}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
  }, []);
  const changed = startsAt !== toLocalInput(activity.startsAt) || expiresAt !== toLocalInput(activity.expiresAt);
  const fields = link.error instanceof ApiError ? link.error.fields : {};

  function save(next: { startsAt: string | null; expiresAt: string | null }) {
    setLocalError(null);
    if (next.startsAt && next.expiresAt && new Date(next.expiresAt) <= new Date(next.startsAt)) {
      setLocalError("El cierre tiene que ser después de la apertura.");
      return;
    }
    link.mutate(next, {
      onSuccess: () => toast.success(next.startsAt || next.expiresAt ? "Horario guardado" : "Horario quitado"),
      onError: (e) => {
        if (!(e instanceof ApiError && Object.keys(e.fields).length)) toast.error(errorMessage(e));
      },
    });
  }

  return (
    <Card className="p-4 sm:p-5 lg:col-start-1">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
        <CalendarClock className="size-5 text-lilac-ink" aria-hidden="true" />
        Horario
      </h2>
      <p className="mt-1 text-sm leading-6 text-text-2">
        Opcional. Fuera de este horario nadie puede entrar ni seguir trabajando. Hora de tu dispositivo ({zone}).
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Abre" optional error={fields.startsAt}>
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}
        </Field>
        <Field label="Cierra" optional error={localError ?? fields.expiresAt}>
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />}
        </Field>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button disabled={!changed} loading={link.isPending} onClick={() => save({ startsAt: fromLocalInput(startsAt), expiresAt: fromLocalInput(expiresAt) })}>
          Guardar horario
        </Button>
        {activity.startsAt || activity.expiresAt ? (
          <Button variant="ghost" disabled={link.isPending} onClick={() => save({ startsAt: null, expiresAt: null })}>
            Quitar horario
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function QrCard({ url, title }: { url: string; title: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [big, setBig] = useState(false);
  useEffect(() => {
    let alive = true;
    setQr(null);
    setFailed(false);
    import("qrcode")
      .then((mod) => {
        const lib = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
        return lib.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: "M", color: { dark: "#14295c", light: "#ffffff" } });
      })
      .then((data) => alive && setQr(data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [url]);
  const fileName = `qr-${title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40) || "actividad"}.png`;

  return (
    <Card className="p-4 text-center sm:p-5 lg:sticky lg:top-8 lg:col-start-2 lg:row-span-5 lg:row-start-1 lg:self-start">
      <h2 className="font-display text-lg font-semibold text-ink">Código QR</h2>
      <p className="mt-1 text-sm text-text-2">Proyectalo en el aula para que lo escaneen con el celular.</p>
      <div className="mx-auto mt-4 w-full max-w-[300px]">
        {qr ? (
          <img src={qr} alt={`Código QR del enlace de «${title}»`} className="aspect-square w-full rounded-md border border-line bg-white" />
        ) : failed ? (
          <Notice tone="amber">No se pudo generar el código QR. Compartí el enlace.</Notice>
        ) : (
          <Skeleton className="aspect-square h-auto w-full rounded-md" />
        )}
      </div>
      {qr ? (
        <div className="mt-4 grid gap-2">
          <Button variant="secondary" icon={<Expand className="size-4" />} onClick={() => setBig(true)}>
            Mostrar en grande
          </Button>
          <a href={qr} download={fileName} className={buttonClass("ghost", "md")}>
            <Download className="size-4" aria-hidden="true" />
            Descargar PNG
          </a>
        </div>
      ) : null}
      <Dialog open={big} onOpenChange={setBig} wide title={title} description="Escaneá el código con la cámara del celular.">
        {qr ? (
          <div className="flex flex-col items-center gap-3 pb-2">
            <img src={qr} alt={`Código QR del enlace de «${title}»`} className="aspect-square w-full max-w-[min(68vh,640px)] rounded-md bg-white" />
            <p className="font-mono text-sm break-all text-text-2">{url.replace(/^https?:\/\//, "")}</p>
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}
