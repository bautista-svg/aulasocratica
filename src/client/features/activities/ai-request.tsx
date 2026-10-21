import { useId, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { FormError, Input, Select } from "@client/components/ui/field";
import { Spinner } from "@client/components/ui/spinner";
import { errorMessage } from "@client/lib/api";
import { ACTIVITY_LIMITS } from "@shared/contracts/activities";

/** "Proponer con IA": optional request + how many, then the result shows up as a suggestion. */
export function AiRequest({
  noun,
  max,
  defaultCount,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  noun: { one: string; many: string };
  max: number;
  defaultCount: number;
  pending: boolean;
  error: unknown;
  onSubmit: (opts: { request: string; count: number }) => void;
  onCancel: () => void;
}) {
  const [request, setRequest] = useState("");
  const [count, setCount] = useState(defaultCount);
  const reqId = useId();
  const countId = useId();
  return (
    <form
      className="rounded-lg border border-lilac/50 bg-lilac-soft/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ request, count });
      }}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-lilac-ink">
        <Sparkles className="size-4" aria-hidden="true" />
        La IA propone, vos revisás antes de usar
      </p>
      <p className="mt-1 text-[13px] leading-5 text-text-2">
        Usa el título, los objetivos, la consigna y el material de la actividad, incluso lo que todavía no guardaste.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_150px]">
        <div>
          <label htmlFor={reqId} className="mb-1.5 block text-sm font-semibold text-text">
            ¿Querés pedirle algo en particular? <span className="font-normal text-text-3">(opcional)</span>
          </label>
          <Input
            id={reqId}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            maxLength={ACTIVITY_LIMITS.aiRequest}
            placeholder="Ej.: más simple, para 1.º año; que mire cómo justifican"
          />
        </div>
        <div>
          <label htmlFor={countId} className="mb-1.5 block text-sm font-semibold text-text">
            Cantidad
          </label>
          <Select id={countId} value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? noun.one : noun.many}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="mt-3" aria-live="polite">
        {pending ? <Spinner label="La IA está preparando la propuesta…" /> : null}
        <FormError message={error ? errorMessage(error) : null} />
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="lilac" icon={<Sparkles className="size-4" />} loading={pending}>
          Proponer
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
