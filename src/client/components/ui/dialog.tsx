import * as RD from "@radix-ui/react-dialog";
import * as RA from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@client/lib/cn";
import { Button, type ButtonVariant } from "./button";
import { Input } from "./field";

const overlay = "fixed inset-0 z-50 bg-ink/35 backdrop-blur-[2px] data-[state=open]:animate-[rise_160ms_ease-out]";
// Bottom sheet on phones, centered card from sm up.
const panel =
  "fixed z-50 flex max-h-[92dvh] w-full flex-col bg-surface shadow-pop outline-none inset-x-0 bottom-0 rounded-t-xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(560px,calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl data-[state=open]:animate-rise";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Wider panel for editors. */
  wide?: boolean;
}

export function Dialog({ open, onOpenChange, title, description, children, footer, className, wide }: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={overlay} />
        <RD.Content className={cn(panel, wide && "sm:w-[min(760px,calc(100vw-32px))]", className)}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-5 pb-4">
            <div className="min-w-0">
              <RD.Title className="font-display text-xl font-semibold text-ink">{title}</RD.Title>
              {description ? <RD.Description className="mt-1 text-sm text-text-2">{description}</RD.Description> : null}
            </div>
            <RD.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Cerrar" className="-mt-1 -mr-2 shrink-0">
                <X className="size-5" />
              </Button>
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="safe-bottom flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-end">{footer}</div>
          ) : null}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: ButtonVariant;
  onConfirm: () => void | Promise<void>;
  /** When set, the user must type this word to enable the confirm button. */
  typeToConfirm?: string;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  variant = "danger",
  onConfirm,
  typeToConfirm,
  loading,
}: ConfirmProps) {
  const [typed, setTyped] = useState("");
  const ready = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase();
  return (
    <RA.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped("");
        onOpenChange(o);
      }}
    >
      <RA.Portal>
        <RA.Overlay className={overlay} />
        <RA.Content className={cn(panel, "sm:w-[min(460px,calc(100vw-32px))]")}>
          <div className="px-5 pt-5 pb-2">
            <RA.Title className="font-display text-xl font-semibold text-ink">{title}</RA.Title>
            <RA.Description asChild>
              <div className="mt-2 space-y-2 text-[15px] leading-6 text-text-2">{description}</div>
            </RA.Description>
            {typeToConfirm ? (
              <label className="mt-4 block text-sm font-semibold text-text">
                Escribí <span className="font-mono text-rose">{typeToConfirm}</span> para confirmar
                <Input className="mt-1.5" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
            ) : null}
          </div>
          <div className="safe-bottom flex flex-col-reverse gap-2 px-5 pt-3 pb-4 sm:flex-row sm:justify-end">
            <RA.Cancel asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </RA.Cancel>
            <Button
              variant={variant}
              disabled={!ready}
              loading={loading}
              onClick={async (e) => {
                e.preventDefault();
                await onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </RA.Content>
      </RA.Portal>
    </RA.Root>
  );
}
