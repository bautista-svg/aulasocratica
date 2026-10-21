// Warns before leaving the activity with unsaved edits: in-app navigation shows a dialog
// (save, leave anyway or keep editing); closing or reloading the tab uses the browser prompt.
import * as RA from "@radix-ui/react-alert-dialog";
import { useBlocker } from "@tanstack/react-router";
import { useRef, useState, type MutableRefObject } from "react";
import { Button } from "@client/components/ui/button";

export function UnsavedGuard({
  dirty,
  onSave,
  bypass,
}: {
  dirty: boolean;
  onSave: () => Promise<boolean>;
  /** Set to true right before a navigation that must not ask (e.g. after deleting the activity). */
  bypass: MutableRefObject<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker({
    // Changing tabs only changes the search params: that never needs a warning.
    shouldBlockFn: ({ current, next }) => dirtyRef.current && !bypass.current && current.pathname !== next.pathname,
    enableBeforeUnload: () => dirtyRef.current && !bypass.current,
    withResolver: true,
  });
  const open = blocker.status === "blocked";

  return (
    <RA.Root open={open} onOpenChange={(o) => !o && blocker.status === "blocked" && blocker.reset()}>
      <RA.Portal>
        <RA.Overlay className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[2px]" />
        <RA.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] w-full flex-col rounded-t-xl bg-surface shadow-pop outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(460px,calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
          <div className="px-5 pt-5 pb-2">
            <RA.Title className="font-display text-xl font-semibold text-ink">Tenés cambios sin guardar</RA.Title>
            <RA.Description className="mt-2 text-[15px] leading-6 text-text-2">
              Si salís ahora, se pierde lo que editaste en la configuración desde la última vez que guardaste.
            </RA.Description>
          </div>
          <div className="safe-bottom flex flex-col-reverse gap-2 px-5 pt-3 pb-4 sm:flex-row sm:justify-end">
            <RA.Cancel asChild>
              <Button variant="secondary">Seguir editando</Button>
            </RA.Cancel>
            <Button variant="danger" disabled={saving} onClick={() => blocker.status === "blocked" && blocker.proceed()}>
              Salir sin guardar
            </Button>
            <Button
              loading={saving}
              onClick={async () => {
                setSaving(true);
                const ok = await onSave();
                setSaving(false);
                if (blocker.status !== "blocked") return;
                if (ok) blocker.proceed();
                else blocker.reset();
              }}
            >
              Guardar y salir
            </Button>
          </div>
        </RA.Content>
      </RA.Portal>
    </RA.Root>
  );
}
