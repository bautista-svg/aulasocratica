import { Link, useLinkProps, useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { InShell } from "./shell-context";
import {
  CircleHelp,
  FileText,
  FolderOpen,
  Bot,
  Home,
  Inbox,
  LayoutGrid,
  Menu as MenuIcon,
  MessageSquarePlus,
  Moon,
  Plus,
  ScanSearch,
  Search,
  Sparkles,
  Sun,
  SquareStack,
  UserRound,
  X,
} from "lucide-react";
import * as RD from "@radix-ui/react-dialog";
import { cn } from "@client/lib/cn";
import { Logo } from "../brand/logo";
import type { Me } from "@shared/contracts/auth";
import { AiStatusBanner } from "./ai-status";
import { useAlertCount } from "@client/features/alerts/api";
import { useDashboard } from "@client/features/dashboard/api";
import { useTheme } from "@client/lib/theme";
import { ClassroomFormDialog } from "@client/features/classrooms/classroom-form";
import { restartTour, TourLayer } from "./tour";
import { SHELL_TOUR } from "@client/features/help/tours";
import { openHelp } from "@client/features/help/store";
import { openPalette } from "./command-palette-store";
import { AccentChooser } from "@client/features/appearance/accent";

const CommandPalette = lazy(() => import("./command-palette"));
const HelpAssistant = lazy(() => import("@client/features/help/assistant"));

type NavItem = { to: string; label: string; icon: typeof Home; exact?: boolean; tour: string };

/** True inside the panel: its <main>, logo and navigation are already on screen. */
export { useInAppShell } from "./shell-context";

const INICIO: NavItem = { to: "/app", label: "Inicio", icon: Home, exact: true, tour: "nav-inicio" };
const AULAS: NavItem = { to: "/app/aulas", label: "Aulas", icon: LayoutGrid, tour: "nav-aulas" };
const PREPARAR: NavItem[] = [
  { to: "/app/actividades", label: "Actividades", icon: SquareStack, tour: "nav-actividades" },
  { to: "/app/tutores", label: "Mis tutores", icon: Bot, tour: "nav-tutores" },
  { to: "/app/materiales", label: "Mis materiales", icon: FolderOpen, tour: "nav-materiales" },
];
const EN_VIVO: NavItem = { to: "/app/en-vivo", label: "En vivo", icon: Sparkles, tour: "nav-en-vivo" };
const REVISAR: NavItem[] = [
  { to: "/app/alertas", label: "Para revisar", icon: Inbox, tour: "nav-revisar" },
  { to: "/app/radiografia", label: "Radiografía", icon: ScanSearch, tour: "nav-radiografia" },
  { to: "/app/informes", label: "Informes", icon: FileText, tour: "nav-informes" },
];
/** Only for workspaces the admin enabled (teachers.can_request_changes). */
const PEDIDOS: NavItem = { to: "/app/pedidos", label: "Pedidos de cambios", icon: MessageSquarePlus, tour: "nav-pedidos" };

/** Open alerts: red when one needs immediate attention. */
function Count({ open, immediate, className }: { open: number; immediate: number; className?: string }) {
  if (open <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold tabular",
        immediate > 0 ? "bg-rose text-surface" : "bg-lilac-soft text-lilac-ink",
        className,
      )}
    >
      <span aria-hidden="true">{open > 99 ? "99+" : open}</span>
      <span className="sr-only">
        , {open} {open === 1 ? "abierta" : "abiertas"}
        {immediate > 0 ? `, ${immediate} de atención inmediata` : ""}
      </span>
    </span>
  );
}

function useIsActive() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (item: { to: string; exact?: boolean }) =>
    item.exact ? pathname === item.to || pathname === `${item.to}/` : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The logo goes home but is never "the current page". A plain <Link> would get
 * aria-current="page" from the router on /app (and, by prefix, on every /app screen).
 */
function HomeLogoLink({ className }: { className?: string }) {
  const { "aria-current": _current, className: _routerClass, ...props } = useLinkProps({ to: "/app" });
  return (
    <a {...props} aria-label="Aula Socrática, inicio" className={cn("inline-flex min-h-10 items-center", className)}>
      <Logo />
    </a>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "A") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const navItem =
  "group relative flex h-8 w-full items-center gap-2.5 rounded-full px-1.5 pr-3 text-[14px] font-medium transition-colors max-lg:h-11";

/** Each section's icon sits in a soft round badge; the current one fills with the accent. */
function NavIcon({ icon: Icon, active, className }: { icon: typeof Home; active?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-[26px] shrink-0 items-center justify-center rounded-full transition-colors",
        active ? "bg-lilac-ink text-surface" : "bg-sunken text-text-2 group-hover:bg-lilac-soft group-hover:text-lilac-ink",
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="size-[14px]" strokeWidth={2.1} />
    </span>
  );
}

function SideLink({ item, active, extra }: { item: NavItem; active: boolean; extra?: ReactNode }) {
  return (
    <Link
      to={item.to}
      data-tour={item.tour}
      activeOptions={{ exact: item.exact ?? false }}
      className={cn(navItem, active ? "bg-lilac-soft text-lilac-ink" : "text-text-2 hover:bg-sunken hover:text-ink")}
    >
      <NavIcon icon={item.icon} active={active} />
      {item.label}
      {extra}
    </Link>
  );
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const isActive = useIsActive();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [newRoom, setNewRoom] = useState(false);
  const keyboardOpen = useVirtualKeyboardOpen();
  const [theme, setTheme] = useTheme();
  const workspaceLabel = me.displayName || "Mi espacio";
  const alerts = useAlertCount();
  const openAlerts = alerts.data?.open ?? 0;
  const immediateAlerts = alerts.data?.immediate ?? 0;
  const dash = useDashboard();
  const liveNow = (dash.data?.live ?? []).reduce((n, a) => n + a.activeNow, 0);
  const pedidos = me.canRequestChanges;

  // Ctrl K / ⌘K opens the search from any screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const liveExtra =
    liveNow > 0 ? (
      <span className="ml-auto flex items-center gap-1.5 text-[12px] font-semibold text-leaf tabular">
        <span className="live-dot" aria-hidden="true" />
        {liveNow}
        <span className="sr-only">{liveNow === 1 ? " alumno trabajando" : " alumnos trabajando"}</span>
      </span>
    ) : null;
  const alertExtra = <Count open={openAlerts} immediate={immediateAlerts} className="ml-auto" />;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      {/* Desktop sidebar */}
      {/* Logo, search and the account stay put; only the list in between scrolls, and only when it does
          not fit and the pointer is on it (overscroll-contain: the page's scroll never moves it). */}
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-hidden border-r border-line bg-surface px-3 py-4 lg:flex">
        <HomeLogoLink className="mb-3 self-start px-1.5" />
        <button
          type="button"
          data-tour="buscar"
          onClick={openPalette}
          className="mb-2 flex h-9 w-full shrink-0 items-center gap-2.5 rounded-full border border-line bg-paper px-3 text-[14px] text-text-3 transition-colors hover:border-line-strong hover:text-text-2"
        >
          <Search className="size-4" aria-hidden="true" />
          Buscar
          <kbd className="ml-auto rounded-full border border-line px-2 font-mono text-[11px] text-text-3">Ctrl K</kbd>
        </button>
        <nav aria-label="Principal" className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1 pb-2 [scrollbar-width:thin]">
          <SideLink item={INICIO} active={isActive(INICIO)} />
          <div className="flex items-center gap-0.5">
            <SideLink item={AULAS} active={isActive(AULAS)} />
            <button
              type="button"
              data-tour="nueva-aula"
              onClick={() => setNewRoom(true)}
              aria-label="Nueva aula"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-lilac-soft hover:text-lilac-ink"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
          <NavGroup label="Preparar" tour="grupo-preparar">
            {PREPARAR.map((item) => (
              <SideLink key={item.to} item={item} active={isActive(item)} />
            ))}
          </NavGroup>
          <NavGroup label="En clase" tour="grupo-en-clase">
            <SideLink item={EN_VIVO} active={isActive(EN_VIVO)} extra={liveExtra} />
          </NavGroup>
          <NavGroup label="Revisar" tour="grupo-revisar">
            {REVISAR.map((item) => (
              <SideLink key={item.to} item={item} active={isActive(item)} extra={item.to === "/app/alertas" ? alertExtra : undefined} />
            ))}
          </NavGroup>
          {pedidos ? (
            <div className="mt-2 border-t border-line pt-2">
              <SideLink item={PEDIDOS} active={isActive(PEDIDOS)} />
            </div>
          ) : null}
        </nav>
        <div className="flex shrink-0 flex-col gap-0.5 border-t border-line pt-2">
          <button type="button" data-tour="ayuda" onClick={openHelp} className={cn(navItem, "text-text-2 hover:bg-sunken hover:text-ink")}>
            <NavIcon icon={Sparkles} className="bg-lilac-soft text-lilac-ink" />
            ¿Dónde está…?
          </button>
          <button type="button" data-tour="recorrido" onClick={() => restartTour(SHELL_TOUR)} className={cn(navItem, "text-text-2 hover:bg-sunken hover:text-ink")}>
            <NavIcon icon={CircleHelp} />
            Recorrido guiado
          </button>
          <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
            <Link
              to="/app/cuenta"
              data-tour="nav-cuenta"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-sunken",
                isActive({ to: "/app/cuenta" }) && "bg-sunken",
              )}
            >
              <span className="initial size-8 rounded-full text-[12px]" style={{ ["--c" as string]: "var(--color-lilac-ink)" }} aria-hidden="true">
                {initials(workspaceLabel)}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13.5px] font-medium text-text">{workspaceLabel}</span>
                <span className="block truncate text-[12px] text-text-3">{me.hasAccount ? "Mi cuenta" : "Sin cuenta · este dispositivo"}</span>
              </span>
            </Link>
            <button
              type="button"
              data-tour="tema"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Pasar a modo claro" : "Pasar a modo oscuro"}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-sunken hover:text-ink"
            >
              {theme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-line bg-paper/90 px-3 backdrop-blur lg:hidden">
          <HomeLogoLink className="mr-auto px-1" />
          <button type="button" onClick={openPalette} aria-label="Buscar" className="inline-flex size-11 items-center justify-center rounded-md text-text-2 hover:bg-sunken">
            <Search className="size-5" aria-hidden="true" />
          </button>
          <button type="button" data-tour="ayuda" onClick={openHelp} aria-label="¿Dónde está…? Preguntale a la ayuda" className="inline-flex size-11 items-center justify-center rounded-md text-lilac-ink hover:bg-sunken">
            <Sparkles className="size-5" aria-hidden="true" />
          </button>
        </header>

        <AiStatusBanner />

        <main id="contenido" className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-9 lg:pb-16">
          <InShell.Provider value={true}>{children}</InShell.Provider>
        </main>

        {/* Mobile tab bar */}
        <nav
          aria-label="Principal"
          className={cn(
            "safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden",
            // While typing on a phone the keyboard takes the bottom half: the tab bar would cover the field.
            keyboardOpen && "hidden",
          )}
        >
          <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
            {[
              { ...INICIO, short: "Inicio" },
              { ...AULAS, short: "Aulas" },
              { ...EN_VIVO, short: "En vivo" },
              { ...REVISAR[0]!, short: "Revisar" },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                data-tour={item.tour}
                activeOptions={{ exact: item.exact ?? false }}
                className={cn("flex flex-col items-center justify-center gap-1 text-[11px] font-medium", isActive(item) ? "text-lilac-ink" : "text-text-3")}
              >
                <span className={cn("relative flex h-7 w-12 items-center justify-center rounded-full transition-colors", isActive(item) && "bg-lilac-soft")}>
                  <item.icon className="size-5" aria-hidden="true" />
                  {item.to === "/app/alertas" ? <Count open={openAlerts} immediate={immediateAlerts} className="absolute -top-1.5 right-0" /> : null}
                  {item.to === "/app/en-vivo" && liveNow > 0 ? <span className="live-dot absolute top-0 right-2" aria-hidden="true" /> : null}
                </span>
                {item.short}
              </Link>
            ))}
            <RD.Root open={moreOpen} onOpenChange={setMoreOpen}>
              <RD.Trigger className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-text-3">
                <span className="flex h-7 w-12 items-center justify-center rounded-full">
                  <MenuIcon className="size-5" aria-hidden="true" />
                </span>
                Más
              </RD.Trigger>
              <RD.Portal>
                <RD.Overlay className="fixed inset-0 z-40 bg-scrim" />
                <RD.Content className="safe-bottom fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-xl bg-surface p-4 shadow-pop data-[state=open]:animate-rise">
                  <div className="mb-2 flex items-center justify-between">
                    <RD.Title className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Más secciones</RD.Title>
                    <RD.Close className="flex size-11 items-center justify-center rounded-md text-text-2 hover:bg-sunken" aria-label="Cerrar">
                      <X className="size-5" />
                    </RD.Close>
                  </div>
                  <RD.Description className="sr-only">Otras secciones de Aula Socrática</RD.Description>
                  <MoreGroup label="Preparar">
                    {PREPARAR.map((item) => (
                      <MoreLink key={item.to} item={item} onPick={() => setMoreOpen(false)} />
                    ))}
                  </MoreGroup>
                  <MoreGroup label="Revisar">
                    {REVISAR.slice(1).map((item) => (
                      <MoreLink key={item.to} item={item} onPick={() => setMoreOpen(false)} />
                    ))}
                  </MoreGroup>
                  <MoreGroup label="Vos">
                    <MoreLink item={{ to: "/app/cuenta", label: "Mi cuenta", icon: UserRound, tour: "nav-cuenta" }} onPick={() => setMoreOpen(false)} />
                    {pedidos ? <MoreLink item={PEDIDOS} onPick={() => setMoreOpen(false)} /> : null}
                    <button
                      type="button"
                      data-tour="tema"
                      onClick={toggleTheme}
                      className="flex h-12 w-full items-center gap-3 rounded-md px-3 text-[15px] font-medium text-text hover:bg-sunken"
                    >
                      {theme === "dark" ? <Sun className="size-5 text-lilac-ink" aria-hidden="true" /> : <Moon className="size-5 text-lilac-ink" aria-hidden="true" />}
                      {theme === "dark" ? "Pasar a modo claro" : "Pasar a modo oscuro"}
                    </button>
                    <button
                      type="button"
                      data-tour="recorrido"
                      onClick={() => {
                        setMoreOpen(false);
                        restartTour(SHELL_TOUR);
                      }}
                      className="flex h-12 w-full items-center gap-3 rounded-md px-3 text-[15px] font-medium text-text hover:bg-sunken"
                    >
                      <CircleHelp className="size-5 text-lilac-ink" aria-hidden="true" />
                      Recorrido guiado
                    </button>
                  </MoreGroup>
                </RD.Content>
              </RD.Portal>
            </RD.Root>
          </div>
        </nav>
      </div>

      <ClassroomFormDialog
        open={newRoom}
        onOpenChange={setNewRoom}
        onSaved={(c) => void navigate({ to: "/app/aulas/$classroomId", params: { classroomId: c.id } })}
      />
      <Suspense fallback={null}>
        <CommandPalette onNewRoom={() => setNewRoom(true)} />
        <HelpAssistant />
      </Suspense>
      <AccentChooser />
      <TourLayer />
    </div>
  );
}

function NavGroup({ label, tour, children }: { label: string; tour: string; children: ReactNode }) {
  return (
    <div data-tour={tour} className="flex flex-col gap-0.5 rounded-md">
      <div className="px-3 pt-2.5 pb-0.5 text-[11.5px] font-medium text-text-3">{label}</div>
      {children}
    </div>
  );
}

function MoreGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <div className="px-3 pb-1 text-[12px] font-medium text-text-3">{label}</div>
      <div className="grid gap-0.5">{children}</div>
    </div>
  );
}

function MoreLink({ item, onPick }: { item: NavItem; onPick: () => void }) {
  return (
    <Link to={item.to} data-tour={item.tour} onClick={onPick} className="flex h-12 items-center gap-3 rounded-md px-3 text-[15px] font-medium text-text hover:bg-sunken">
      <NavIcon icon={item.icon} className="size-8" />
      {item.label}
    </Link>
  );
}

/** True while a text field has focus and the on-screen keyboard shrinks the visual viewport. */
function useVirtualKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "file"].includes((el as HTMLInputElement).type)) || el.isContentEditable);
      const shrunk = vv ? vv.height < window.innerHeight - 150 : false;
      setOpen(typing && shrunk);
    };
    const later = () => setTimeout(update, 50);
    vv?.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      vv?.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return open;
}
