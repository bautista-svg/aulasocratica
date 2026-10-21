import { useState } from "react";
import { toast } from "sonner";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Badge, Card, CardHeader, ErrorState, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Switch } from "@client/components/ui/controls";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@client/components/ui/field";
import { errorMessage } from "@client/lib/api";
import { ALERT_CATEGORY_LABELS, ALERT_SEVERITY_LABELS, type AlertCategory, type AlertSeverity } from "@shared/domain/alerts";
import { useAlertMutations, useClassroomAlerts } from "./api";

const severityTone = (s: string) => (s === "immediate" ? "rose" : "amber") as "rose" | "amber";

export function AlertsPanel({ classroomId }: { classroomId: string }) {
  const q = useClassroomAlerts(classroomId);
  const m = useAlertMutations(classroomId);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  if (q.isPending) return <SkeletonList rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const onError = (e: unknown) => toast.error(errorMessage(e));

  return (
    <div className="grid gap-5">
      <p className="max-w-3xl text-[15px] leading-6 text-text-2">
        Mientras los alumnos trabajan, la IA lee sus mensajes y te avisa en la vista en vivo si detecta alguna de estas situaciones. Son
        sugerencias: vos las revisás. Las de pegar texto y salir de la actividad las detecta el navegador, no la IA. Los alumnos no ven las
        alertas.
      </p>
      <Card>
        <CardHeader title="Alertas de la plataforma" description="Las de seguridad están siempre activas." />
        <ul className="mt-3 divide-y divide-line">
          {q.data.builtins.map((a) => (
            <li key={a.key} className="px-5 py-3.5">
              <Switch
                checked={a.enabled}
                disabled={a.locked || m.toggleBuiltin.isPending}
                onCheckedChange={(enabled) => m.toggleBuiltin.mutate({ key: a.key, enabled }, { onError })}
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    {a.name}
                    <Badge tone={severityTone(a.severity)}>{ALERT_SEVERITY_LABELS[a.severity]}</Badge>
                    {a.locked ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-text-3">
                        <Lock className="size-3" aria-hidden="true" /> Siempre activa
                      </span>
                    ) : null}
                  </span>
                }
                description={`${ALERT_CATEGORY_LABELS[a.category]} · ${a.description}`}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Alertas propias del aula"
          description="Describí con tus palabras qué querés que la IA te avise."
          action={
            <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nueva alerta
            </Button>
          }
        />
        {q.data.custom.length === 0 ? (
          <p className="px-5 pt-3 pb-5 text-sm text-text-3">Todavía no creaste alertas propias.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {q.data.custom.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <Switch
                    checked={a.enabled}
                    onCheckedChange={(enabled) => m.update.mutate({ id: a.id, enabled }, { onError })}
                    label={
                      <span className="flex flex-wrap items-center gap-2">
                        {a.name}
                        <Badge tone={severityTone(a.severity)}>{ALERT_SEVERITY_LABELS[a.severity as AlertSeverity] ?? a.severity}</Badge>
                      </span>
                    }
                    description={`${ALERT_CATEGORY_LABELS[a.category as AlertCategory] ?? a.category} · ${a.description}`}
                  />
                </div>
                <Button variant="ghost" size="icon" aria-label={`Eliminar alerta ${a.name}`} onClick={() => setRemoving(a)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <NewAlertDialog open={creating} onOpenChange={setCreating} classroomId={classroomId} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`¿Eliminar la alerta «${removing?.name ?? ""}»?`}
        description={<p>Las alertas que ya se generaron quedan registradas en cada actividad.</p>}
        confirmLabel="Eliminar alerta"
        loading={m.remove.isPending}
        onConfirm={() => {
          if (removing) m.remove.mutate(removing.id, { onSuccess: () => setRemoving(null), onError });
        }}
      />
    </div>
  );
}

function NewAlertDialog({ open, onOpenChange, classroomId }: { open: boolean; onOpenChange: (o: boolean) => void; classroomId: string }) {
  const [v, setV] = useState({ name: "", description: "", category: "academica", severity: "review" });
  const { create } = useAlertMutations(classroomId);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setV({ name: "", description: "", category: "academica", severity: "review" });
        onOpenChange(o);
      }}
      title="Nueva alerta"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            loading={create.isPending}
            disabled={v.name.trim().length < 2 || v.description.trim().length < 5}
            onClick={() =>
              create.mutate(v, {
                onSuccess: () => {
                  toast.success("Alerta creada");
                  onOpenChange(false);
                },
              })
            }
          >
            Crear alerta
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Nombre">
          {(p) => <Input id={p.id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={80} placeholder="Confunde fracción con división" />}
        </Field>
        <Field label="Qué tiene que detectar" hint="Escribilo como se lo explicarías a un colega.">
          {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} minRows={3} maxLength={400} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            {(p) => (
              <Select id={p.id} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
                {Object.entries(ALERT_CATEGORY_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Urgencia">
            {(p) => (
              <Select id={p.id} value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })}>
                {Object.entries(ALERT_SEVERITY_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <FormError message={create.isError ? errorMessage(create.error) : null} />
      </div>
    </Dialog>
  );
}
