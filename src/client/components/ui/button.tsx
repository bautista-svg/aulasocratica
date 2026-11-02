import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { cn } from "@client/lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "lilac";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lilac-ink";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary shadow-1 hover:bg-primary-hover",
  secondary: "bg-surface text-ink border border-line-strong shadow-1 hover:border-ink/30 hover:bg-sunken",
  ghost: "text-text-2 hover:bg-sunken hover:text-ink",
  danger: "bg-rose text-surface hover:bg-rose-hover",
  lilac: "bg-lilac-soft text-lilac-ink hover:brightness-95",
};

// On phones (< 640 px) every size is at least 44 × 44 px, the touch target the app promises
// (docs/ARQUITECTURA.md). `max-sm:` keeps a caller's own height (e.g. "h-11") working everywhere.
const sizes: Record<ButtonSize, string> = {
  sm: "h-8 max-sm:h-11 rounded-md px-3 text-[13.5px]",
  md: "h-10 max-sm:h-11 rounded-md px-4 text-[14px]",
  lg: "h-11 rounded-md px-5 text-[15px]",
  icon: "h-9 w-9 max-sm:h-11 max-sm:w-11 rounded-md",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

type ButtonLinkProps = LinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  icon?: ReactNode;
  children?: ReactNode;
};

export function ButtonLink({ variant = "primary", size = "md", className, icon, children, ...props }: ButtonLinkProps) {
  return (
    <Link {...(props as LinkProps)} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}
