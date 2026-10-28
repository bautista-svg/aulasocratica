// "Nuevos cambios en la aplicación": shown once per teacher and release (the server remembers it as
// soon as it opens, so closing the tab or reloading never brings it back); it lists only what is
// new to that teacher. An ink header where the
// logo's lilac "?" and leaf float on the same navy as its bubble, then the changes, one by one.
import { useEffect, useMemo, useRef, useState } from "react";
import * as RD from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, Bot, Copy, FileUp, KeyRound, Languages, Link2, ListChecks, ListOrdered, LogIn, MessageCircleQuestion, MessageSquareQuote, MessageSquareText, NotebookPen, PenLine, Scale, ScanText, Sprout, TrendingUp, UsersRound, X, type LucideIcon } from "lucide-react";
import { cn } from "@client/lib/cn";
import { api } from "@client/lib/api";
import { meKey } from "@client/lib/session";
import { Button } from "@client/components/ui/button";
import { LogoMark } from "@client/components/brand/logo";
import { NEWS, unseenNews, type NewsKey } from "@shared/domain/news";
import type { Me } from "@shared/contracts/auth";

const ICONS: Record<NewsKey, { icon: LucideIcon; tile: string }> = {
  alerts: { icon: Bell, tile: "bg-rose-soft text-rose" },
  deliverables: { icon: FileUp, tile: "bg-ink-soft text-ink" },
  aspects: { icon: Sprout, tile: "bg-leaf-soft text-leaf" },
  rubric: { icon: Scale, tile: "bg-lilac-soft text-lilac-ink" },
  tutors: { icon: Bot, tile: "bg-lilac-soft text-lilac-ink" },
  links: { icon: Link2, tile: "bg-amber-soft text-amber" },
  scans: { icon: ScanText, tile: "bg-ink-soft text-ink" },
  english: { icon: Languages, tile: "bg-leaf-soft text-leaf" },
  consignas: { icon: ListOrdered, tile: "bg-amber-soft text-amber" },
  closing: { icon: MessageCircleQuestion, tile: "bg-lilac-soft text-lilac-ink" },
  ending: { icon: MessageSquareText, tile: "bg-lilac-soft text-lilac-ink" },
  tutorRules: { icon: PenLine, tile: "bg-ink-soft text-ink" },
  signin: { icon: LogIn, tile: "bg-leaf-soft text-leaf" },
  google: { icon: KeyRound, tile: "bg-leaf-soft text-leaf" },
  skills: { icon: Sprout, tile: "bg-lilac-soft text-lilac-ink" },
  structure: { icon: ListOrdered, tile: "bg-ink-soft text-ink" },
  trash: { icon: Copy, tile: "bg-amber-soft text-amber" },
  formative: { icon: TrendingUp, tile: "bg-leaf-soft text-leaf" },
  indicators: { icon: ListChecks, tile: "bg-lilac-soft text-lilac-ink" },
  reflection: { icon: NotebookPen, tile: "bg-amber-soft text-amber" },
  sharedSummary: { icon: MessageSquareQuote, tile: "bg-leaf-soft text-leaf" },
  divisions: { icon: UsersRound, tile: "bg-lilac-soft text-lilac-ink" },
};

export function WhatsNew({ me }: { me: Me }) {
  // Read once: what this teacher had not seen when the app opened.
  const items = useMemo(() => unseenNews(me.newsSeen), []);
  const [open, setOpen] = useState(items.length > 0);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const marked = useRef(false);

  useEffect(() => {
    if (!open || marked.current) return;
    marked.current = true;
    // Remembered right away: "una sola vez" holds even if the tab is closed without reading it.
    api
      .post<{ teacher: Me }>("/api/auth/me/news", { id: NEWS.id })
      .then((r) => qc.setQueryData(meKey, { teacher: r.teacher }))
      .catch(() => undefined);
  }, [open, qc]);

  return (
    <RD.Root open={open} onOpenChange={setOpen}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[3px] data-[state=open]:animate-[rise_200ms_ease-out]" />
        <RD.Content
          className={cn(
            "fixed z-50 flex max-h-[94dvh] w-full flex-col overflow-hidden bg-surface shadow-pop outline-none",
            "inset-x-0 bottom-0 rounded-t-[22px] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(540px,calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px]",
            "data-[state=open]:animate-rise",
          )}
          // Focus the panel, not the close button: the title is read first and no ring shows on open.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
        >
          <header className="relative shrink-0 overflow-hidden bg-ink px-6 pt-5 pb-6 text-white sm:px-7 sm:pt-6 sm:pb-7">
            {/* The logo's "?" and leaf, cropped at the corner: its navy bubble disappears into the header. */}
            <div
              className="pointer-events-none absolute -top-10 -right-12 size-60 rounded-full bg-[radial-gradient(circle,rgb(155_135_232/0.38),transparent_68%)]"
              aria-hidden="true"
            />
            <LogoMark className="pointer-events-none absolute -right-8 -bottom-10 size-36 rotate-[8deg] sm:-right-7 sm:-bottom-9 sm:size-44" />
            <span className="pointer-events-none absolute top-8 right-40 hidden size-1.5 rounded-full bg-leaf-bright sm:block" aria-hidden="true" />
            <span className="pointer-events-none absolute top-16 right-28 hidden size-1 rounded-full bg-lilac sm:block" aria-hidden="true" />
            <span className="pointer-events-none absolute right-48 bottom-10 hidden size-1 rounded-full bg-white/50 sm:block" aria-hidden="true" />

            <RD.Close asChild>
              <button
                type="button"
                aria-label="Cerrar"
                className="absolute top-3.5 right-3.5 z-10 inline-flex size-10 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lilac max-sm:size-11"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </RD.Close>

            <p className="relative inline-flex items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-2 text-xs font-semibold tracking-wide text-lilac-soft">
              <span className="size-1.5 rounded-full bg-leaf-bright" aria-hidden="true" />
              Novedades · {NEWS.when}
            </p>
            <RD.Title className="relative mt-3 max-w-[15ch] font-display text-[28px] leading-[1.08] font-semibold tracking-tight sm:text-[34px]">
              {NEWS.title}
            </RD.Title>
            {/* Clear of the "?" in the corner on phones. */}
            <RD.Description className="relative mt-2.5 max-w-[34ch] pr-24 text-[15px] leading-6 text-white/80 sm:mt-3 sm:pr-0">{NEWS.intro}</RD.Description>
          </header>

          {/* On short phones the list scrolls: the fading edge says there is more below. */}
          <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2 max-sm:[mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)] max-sm:pb-6 sm:space-y-1 sm:px-4 sm:py-3">
            {items.map((item, i) => {
              const { icon: Icon, tile } = ICONS[item.key];
              const link = item.link;
              return (
                <li key={item.key} className="flex gap-4 rounded-[14px] px-3 py-2.5 animate-rise sm:py-3" style={{ animationDelay: `${120 + i * 70}ms` }}>
                  <span className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-[12px]", tile)} aria-hidden="true">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[16px] leading-6 font-semibold text-text">{item.title}</p>
                    <p className="mt-0.5 text-[14.5px] leading-[1.45] text-text-2">{item.text}</p>
                    {link ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          void navigate({ to: link.to });
                        }}
                        className="-mx-1 mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-sm font-semibold text-ink underline-offset-4 hover:underline max-sm:min-h-11"
                      >
                        {link.label}
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <footer className="safe-bottom flex shrink-0 flex-col-reverse items-stretch gap-2.5 border-t border-line px-6 pt-3.5 pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-7 sm:pt-4 sm:pb-5">
            <p className="text-center text-xs text-text-3 sm:text-left">Este aviso aparece una sola vez.</p>
            <RD.Close asChild>
              <Button size="lg" className="sm:min-w-40">
                Entendido
              </Button>
            </RD.Close>
          </footer>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
