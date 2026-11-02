// Search (Ctrl K): go to any section, open a classroom or an activity, or do a common action.
// When nothing matches, the question goes to the help assistant.
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as RD from "@radix-ui/react-dialog";
import { ArrowRight, CornerDownLeft, Moon, Plus, Search, Sparkles, Sun } from "lucide-react";
import { cn } from "@client/lib/cn";
import { useClassrooms } from "@client/features/classrooms/api";
import { useAllActivities } from "@client/features/dashboard/api";
import { useTheme } from "@client/lib/theme";
import { openHelp } from "@client/features/help/store";
import { activityState } from "@shared/domain/activity-state";
import { setPaletteOpen, usePaletteOpen } from "./command-palette-store";
import { restartTour } from "./tour";
import { SHELL_TOUR } from "@client/features/help/tours";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const SECTIONS: [string, string][] = [
  ["/app", "Inicio"],
  ["/app/aulas", "Aulas"],
  ["/app/actividades", "Actividades"],
  ["/app/crear", "Crear con IA"],
  ["/app/tutores", "Mis tutores"],
  ["/app/materiales", "Mis materiales"],
  ["/app/en-vivo", "En vivo"],
  ["/app/alertas", "Para revisar"],
  ["/app/radiografia", "Radiografía"],
  ["/app/informes", "Informes"],
  ["/app/cuenta", "Mi cuenta"],
];

export default function CommandPalette({ onNewRoom }: { onNewRoom: () => void }) {
  const open = usePaletteOpen();
  return (
    <RD.Root open={open} onOpenChange={setPaletteOpen}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-[2px] data-[state=open]:animate-[rise_160ms_ease-out]" />
        <RD.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[12dvh] z-50 mx-auto max-w-[560px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop outline-none data-[state=open]:animate-pop"
        >
          <RD.Title className="sr-only">Buscar</RD.Title>
          {open ? <PaletteBody onNewRoom={onNewRoom} /> : null}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function PaletteBody({ onNewRoom }: { onNewRoom: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [theme, setTheme] = useTheme();
  const rooms = useClassrooms();
  const acts = useAllActivities();
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => setPaletteOpen(false);
  const go = (to: string) => {
    close();
    void navigate({ to });
  };

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      { id: "new-room", group: "Acciones", label: "Nueva aula", icon: <Plus className="size-4" />, run: () => (close(), onNewRoom()) },
      { id: "new-ai", group: "Acciones", label: "Crear una actividad con IA", icon: <Sparkles className="size-4" />, run: () => go("/app/crear") },
      {
        id: "theme",
        group: "Acciones",
        label: theme === "dark" ? "Pasar a modo claro" : "Pasar a modo oscuro",
        icon: theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />,
        run: () => (close(), setTheme(theme === "dark" ? "light" : "dark")),
      },
      { id: "tour", group: "Acciones", label: "Ver el recorrido guiado", icon: <ArrowRight className="size-4" />, run: () => (close(), restartTour(SHELL_TOUR)) },
      ...SECTIONS.map(([to, label]) => ({ id: `s:${to}`, group: "Ir a", label, icon: <ArrowRight className="size-4" />, run: () => go(to) })),
      ...(rooms.data ?? []).map((r) => ({
        id: `r:${r.id}`,
        group: "Aulas",
        label: r.name,
        hint: [r.grade, r.division].filter(Boolean).join(" "),
        run: () => (close(), void navigate({ to: "/app/aulas/$classroomId", params: { classroomId: r.id } })),
      })),
      ...(acts.data?.activities ?? []).map((a) => ({
        id: `a:${a.id}`,
        group: "Actividades",
        label: a.title,
        hint: `${a.classroomName} · ${activityState(a).label}`,
        run: () => (close(), void navigate({ to: "/app/actividades/$activityId", params: { activityId: a.id } })),
      })),
    ];
    const q = fold(query.trim());
    if (!q) {
      // Nothing typed: the actions, the sections and the most recent classrooms and activities.
      const recent = (group: string, n: number) => all.filter((i) => i.group === group).slice(0, n);
      return [...all.filter((i) => i.group === "Acciones" || i.group === "Ir a"), ...recent("Aulas", 5), ...recent("Actividades", 6)];
    }
    return all.filter((i) => fold(`${i.label} ${i.hint ?? ""}`).includes(q)).slice(0, 40);
  }, [query, rooms.data, acts.data, theme]);

  const ask: Item | null = query.trim().length > 2 ? { id: "ask", group: "Ayuda", label: `Preguntarle a la ayuda: «${query.trim()}»`, icon: <Sparkles className="size-4" />, run: () => (close(), openHelp(query.trim())) } : null;
  const shown = ask ? [...items, ask] : items;
  const current = Math.min(active, Math.max(0, shown.length - 1));

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(1, shown.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + shown.length) % Math.max(1, shown.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      shown[current]?.run();
    }
  }

  let lastGroup = "";
  return (
    <div onKeyDown={onKey}>
      <div className="flex h-13 items-center gap-2.5 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-text-3" aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Buscá un aula, una actividad o una sección"
          aria-label="Buscar"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[current] ? `pal-${shown[current]!.id}` : undefined}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-text-3"
        />
        <kbd className="hidden rounded border border-line px-1.5 font-mono text-[11px] text-text-3 sm:block">Esc</kbd>
      </div>
      <div ref={listRef} id="palette-list" role="listbox" aria-label="Resultados" className="max-h-[min(60dvh,440px)] overflow-y-auto p-1.5">
        {shown.length === 0 ? <p className="px-3 py-6 text-center text-sm text-text-2">Escribí al menos tres letras para preguntarle a la ayuda.</p> : null}
        {shown.map((it, i) => {
          const header = it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          return (
            <div key={it.id}>
              {header ? <div className="px-2.5 pt-2.5 pb-1 text-[11.5px] font-medium text-text-3">{header}</div> : null}
              <div
                id={`pal-${it.id}`}
                role="option"
                aria-selected={i === current}
                onMouseMove={() => i !== current && setActive(i)}
                onClick={it.run}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[14px] text-text max-sm:min-h-11",
                  i === current && "bg-lilac-soft text-lilac-ink",
                )}
              >
                <span className={cn("text-text-3", i === current && "text-lilac-ink")}>{it.icon ?? <ArrowRight className="size-4" />}</span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint ? <span className="max-w-[45%] shrink-0 truncate text-[12.5px] text-text-3">{it.hint}</span> : null}
                {i === current ? <CornerDownLeft className="size-3.5 shrink-0" aria-hidden="true" /> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-[12px] text-text-3 sm:flex">
        <span>
          <kbd className="font-mono">↑↓</kbd> moverte
        </span>
        <span>
          <kbd className="font-mono">Enter</kbd> abrir
        </span>
      </div>
    </div>
  );
}
