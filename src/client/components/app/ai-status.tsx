import { AlertTriangle } from "lucide-react";
import { useAiStatus } from "@client/lib/session";

/** Honest banner: when the AI is not available, every AI action would fail — say so up front. */
export function AiStatusBanner() {
  const q = useAiStatus(true);
  const status = q.data?.ai;
  if (!status || status === "ok") return null;
  return (
    <div role="status" className="border-b border-amber/20 bg-amber-soft px-4 py-2.5 text-sm text-amber sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-[1120px] items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          {status === "not_configured"
            ? "La inteligencia artificial todavía no está configurada en este servidor. Podés crear aulas y actividades, pero el tutor y las propuestas de IA no van a funcionar hasta que se configure."
            : "La inteligencia artificial no está respondiendo en este momento. Lo que no use IA funciona con normalidad; volvé a intentar en unos minutos."}
        </p>
      </div>
    </div>
  );
}
