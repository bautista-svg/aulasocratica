import * as RS from "@radix-ui/react-switch";
import * as RC from "@radix-ui/react-checkbox";
import * as RT from "@radix-ui/react-tabs";
import * as RM from "@radix-ui/react-dropdown-menu";
import { Check, Copy } from "lucide-react";
import { startTransition, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@client/lib/cn";
import { Button } from "./button";

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  return (
    // Disabled: only the control is dimmed. Dimming the text too dropped it below 4.5:1 (WCAG 1.4.3).
    <label className={cn("flex cursor-pointer items-start justify-between gap-4", disabled && "cursor-not-allowed")}>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-text">{label}</span>
        {description ? <span className="mt-0.5 block text-sm leading-5 text-text-2">{description}</span> : null}
      </span>
      <RS.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        // 48 × 28 visible; the invisible ::before makes the touch target 48 × 44.
        className="relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-line-strong transition-colors before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-ink"
      >
        <RS.Thumb className="block size-5.5 translate-x-[3px] rounded-full bg-white shadow-1 transition-transform data-[state=checked]:translate-x-[23px]" />
      </RS.Root>
    </label>
  );
}

export function Checkbox({ checked, onCheckedChange, label, description, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed")}>
      <RC.Root
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        // 20 px box with a 44 px invisible touch target around it.
        className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-line-strong bg-surface before:absolute before:-inset-3 before:content-[''] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-ink data-[state=checked]:bg-ink"
      >
        <RC.Indicator>
          <Check className="size-3.5 text-white" strokeWidth={3} />
        </RC.Indicator>
      </RC.Root>
      <span className="min-w-0">
        <span className="block text-[15px] text-text">{label}</span>
        {description ? <span className="block text-sm text-text-2">{description}</span> : null}
      </span>
    </label>
  );
}

/**
 * Tabs whose panels stay mounted (hidden), so switching tabs never loses unsaved edits.
 * The active panel renders first; the hidden ones mount right after, inside a transition
 * (interruptible), so the first render of a heavy page is not one long blocking task.
 */
export function Tabs({
  value,
  onValueChange,
  items,
  className,
  listClassName,
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: { value: string; label: ReactNode; content: ReactNode; badge?: ReactNode }[];
  className?: string;
  listClassName?: string;
}) {
  const [mountAll, setMountAll] = useState(false);
  useEffect(() => startTransition(() => setMountAll(true)), []);
  return (
    <RT.Root value={value} onValueChange={onValueChange} className={className}>
      <RT.List
        className={cn(
          "-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0",
          listClassName,
        )}
      >
        {items.map((it) => (
          <RT.Trigger
            key={it.value}
            value={it.value}
            className="relative -mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-[15px] font-semibold text-text-2 transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink"
          >
            {it.label}
            {it.badge}
          </RT.Trigger>
        ))}
      </RT.List>
      {items.map((it) => (
        <RT.Content key={it.value} value={it.value} forceMount className="outline-none data-[state=inactive]:hidden">
          {mountAll || it.value === value ? it.content : null}
        </RT.Content>
      ))}
    </RT.Root>
  );
}

export function Menu({ trigger, items, align = "end" }: { trigger: ReactNode; items: ({ label: ReactNode; onSelect: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean } | "separator")[]; align?: "start" | "end" }) {
  return (
    <RM.Root>
      <RM.Trigger asChild>{trigger}</RM.Trigger>
      <RM.Portal>
        <RM.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-52 rounded-md border border-line bg-surface p-1.5 shadow-pop data-[state=open]:animate-rise"
        >
          {items.map((it, i) =>
            it === "separator" ? (
              <RM.Separator key={i} className="my-1 h-px bg-line" />
            ) : (
              <RM.Item
                key={i}
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={cn(
                  "flex h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-[15px] outline-none select-none max-sm:h-11 data-[disabled]:opacity-50 data-[highlighted]:bg-sunken",
                  it.danger ? "text-rose" : "text-text",
                )}
              >
                {it.icon}
                {it.label}
              </RM.Item>
            ),
          )}
        </RM.Content>
      </RM.Portal>
    </RM.Root>
  );
}

export function CopyButton({ value, label = "Copiar", copiedLabel = "Copiado", className, variant = "secondary" }: { value: string; label?: string; copiedLabel?: string; className?: string; variant?: "secondary" | "primary" | "ghost" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      size="sm"
      className={className}
      icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          toast.error("No se pudo copiar. Seleccioná el texto y copialo a mano.");
        }
      }}
    >
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </Button>
  );
}
