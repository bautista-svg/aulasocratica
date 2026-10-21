import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Home,
  School,
  Sparkles,
  FolderOpen,
  Bot,
  ScanSearch,
  FileText,
  Menu as MenuIcon,
  UserRound,
  X,
} from "lucide-react";
import * as RD from "@radix-ui/react-dialog";
import { cn } from "@client/lib/cn";
import { Logo } from "../brand/logo";
import type { Me } from "@shared/contracts/auth";
import { AiStatusBanner } from "./ai-status";

type NavItem = { to: string; label: string; icon: typeof Home; exact?: boolean };

const NAV: NavItem[] = [
  { to: "/app", label: "Inicio", icon: Home, exact: true },
  { to: "/app/aulas", label: "Aulas", icon: School },
  { to: "/app/crear", label: "Crear con IA", icon: Sparkles },
  { to: "/app/tutores", label: "Mis tutores", icon: Bot },
  { to: "/app/materiales", label: "Mis materiales", icon: FolderOpen },
  { to: "/app/radiografia", label: "Radiografía", icon: ScanSearch },
  { to: "/app/informes", label: "Informes", icon: FileText },
];

const MOBILE_TABS = ["/app", "/app/aulas", "/app/crear", "/app/tutores"];

function useIsActive() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (item: NavItem) => (item.exact ? pathname === item.to || pathname === `${item.to}/` : pathname.startsWith(item.to));
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const isActive = useIsActive();
  const [moreOpen, setMoreOpen] = useState(false);
  const workspaceLabel = me.displayName || "Mi espacio";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface/70 px-4 py-5 lg:flex">
        <Link to="/app" className="mb-7 px-2" aria-label="Aula Socrática, inicio">
          <Logo />
        </Link>
        <nav aria-label="Principal" className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex h-10 items-center gap-3 rounded-md px-3 text-[15px] font-semibold transition-colors",
                isActive(item) ? "bg-ink-soft text-ink" : "text-text-2 hover:bg-sunken hover:text-ink",
              )}
              aria-current={isActive(item) ? "page" : undefined}
            >
              <item.icon className="size-[18px] shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <Link
            to="/app/cuenta"
            className={cn(
              "flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong",
              isActive({ to: "/app/cuenta", label: "", icon: Home }) && "border-ink/30",
            )}
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-lilac-soft text-lilac-ink">
              <UserRound className="size-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-text">{workspaceLabel}</span>
              <span className="block text-xs text-text-3">{me.hasAccount ? me.email : "Sin cuenta · este dispositivo"}</span>
            </span>
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-paper/90 px-4 backdrop-blur lg:hidden">
          <Link to="/app" aria-label="Aula Socrática, inicio">
            <Logo />
          </Link>
          <Link
            to="/app/cuenta"
            className="flex size-10 items-center justify-center rounded-full bg-lilac-soft text-lilac-ink"
            aria-label={`Mi espacio: ${workspaceLabel}`}
          >
            <UserRound className="size-5" aria-hidden="true" />
          </Link>
        </header>

        <AiStatusBanner />

        <main id="contenido" className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
          {children}
        </main>

        {/* Mobile tab bar */}
        <nav
          aria-label="Principal"
          className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
        >
          <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
            {NAV.filter((n) => MOBILE_TABS.includes(n.to)).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={isActive(item) ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-[11px] font-semibold",
                  isActive(item) ? "text-ink" : "text-text-3",
                )}
              >
                <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", isActive(item) && "bg-ink-soft")}>
                  <item.icon className="size-5" aria-hidden="true" />
                </span>
                {item.label === "Crear con IA" ? "Crear" : item.label === "Mis tutores" ? "Tutores" : item.label}
              </Link>
            ))}
            <RD.Root open={moreOpen} onOpenChange={setMoreOpen}>
              <RD.Trigger className="flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-text-3">
                <span className="flex h-7 w-12 items-center justify-center rounded-full">
                  <MenuIcon className="size-5" aria-hidden="true" />
                </span>
                Más
              </RD.Trigger>
              <RD.Portal>
                <RD.Overlay className="fixed inset-0 z-40 bg-ink/30" />
                <RD.Content className="safe-bottom fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-surface p-4 shadow-pop data-[state=open]:animate-rise">
                  <div className="mb-2 flex items-center justify-between">
                    <RD.Title className="font-display text-lg font-semibold text-ink">Más secciones</RD.Title>
                    <RD.Close className="flex size-10 items-center justify-center rounded-md text-text-2 hover:bg-sunken" aria-label="Cerrar">
                      <X className="size-5" />
                    </RD.Close>
                  </div>
                  <RD.Description className="sr-only">Otras secciones de Aula Socrática</RD.Description>
                  <div className="grid gap-1">
                    {[...NAV.filter((n) => !MOBILE_TABS.includes(n.to)), { to: "/app/cuenta", label: "Mi espacio", icon: UserRound }].map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMoreOpen(false)}
                        className="flex h-12 items-center gap-3 rounded-md px-3 text-base font-semibold text-text hover:bg-sunken"
                      >
                        <item.icon className="size-5 text-lilac-ink" aria-hidden="true" />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </RD.Content>
              </RD.Portal>
            </RD.Root>
          </div>
        </nav>
      </div>
    </div>
  );
}
