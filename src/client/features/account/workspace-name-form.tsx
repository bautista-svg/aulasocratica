import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@client/components/ui/button";
import { Field, Input } from "@client/components/ui/field";
import { ApiError, errorMessage } from "@client/lib/api";
import { useUpdateName } from "./api";

/** Name shown in the greeting and the menu ("Profe Laura", "Lengua 2.º año"). */
export function WorkspaceNameForm({
  current,
  onSaved,
  compact,
  autoFocus,
}: {
  current: string;
  onSaved?: () => void;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(current);
  const save = useUpdateName();
  useEffect(() => setValue(current), [current]);
  const fieldError =
    save.error instanceof ApiError ? (save.error.fields.displayName ?? errorMessage(save.error)) : save.error ? errorMessage(save.error) : undefined;
  const dirty = value.trim() !== current.trim();

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty) return;
        save.mutate(value.trim(), {
          onSuccess: () => {
            toast.success(value.trim() ? "Nombre guardado" : "Nombre borrado");
            onSaved?.();
          },
        });
      }}
    >
      <Field
        className="min-w-0 flex-1"
        label={compact ? "¿Cómo querés que te llamemos?" : "Tu nombre o el de tu espacio"}
        hint={compact ? undefined : "Aparece en el saludo de Inicio y en el menú. Tus alumnos no lo ven."}
        error={fieldError}
      >
        {(p) => (
          <Input
            id={p.id}
            aria-describedby={p.describedBy}
            invalid={p.invalid}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={80}
            placeholder="Por ejemplo: Profe Laura"
            autoComplete="name"
            autoFocus={autoFocus}
          />
        )}
      </Field>
      <Button type="submit" loading={save.isPending} disabled={!dirty} className="sm:mt-[26px]">
        Guardar
      </Button>
    </form>
  );
}
