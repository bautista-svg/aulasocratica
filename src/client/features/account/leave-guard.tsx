import { useBlocker } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ConfirmDialog } from "@client/components/ui/dialog";

/**
 * Asks before leaving the screen (in-app navigation with an app dialog, closing the tab with
 * the browser's own prompt) while `when` is true: unsaved text, a code not saved yet…
 */
export function LeaveGuard({
  when,
  title = "¿Salir sin guardar?",
  description = "Tenés cambios sin guardar. Si salís ahora, se pierden.",
  confirmLabel = "Salir sin guardar",
  cancelLabel = "Quedarme",
}: {
  when: boolean;
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const blocker = useBlocker({ shouldBlockFn: () => when, enableBeforeUnload: () => when, withResolver: true });
  return (
    <ConfirmDialog
      open={blocker.status === "blocked"}
      onOpenChange={(o) => {
        if (!o) blocker.reset?.();
      }}
      title={title}
      description={<p>{description}</p>}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      onConfirm={() => blocker.proceed?.()}
    />
  );
}
