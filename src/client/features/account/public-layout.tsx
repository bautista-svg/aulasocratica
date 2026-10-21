import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Logo, LogoMark } from "@client/components/brand/logo";
import { buttonClass } from "@client/components/ui/button";

/** Same frame as the landing (header with the logo, paper background, quiet footer). */
export function PublicLayout({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <Link to="/" aria-label="Aula Socrática, inicio" activeOptions={{ exact: true }} className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        <nav aria-label="Cuenta" className="flex items-center gap-1">
          {nav ?? (
            <Link to="/" activeOptions={{ exact: true }} className={buttonClass("ghost", "sm")}>
              Inicio
            </Link>
          )}
        </nav>
      </header>
      <main id="contenido" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-5 py-8 text-sm text-text-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="inline-flex items-center gap-2">
            <LogoMark className="size-5" /> Aula Socrática
          </span>
          <nav aria-label="Legal" className="flex gap-5">
            <Link to="/privacidad" className="-my-3 inline-flex min-h-11 items-center hover:text-ink">
              Privacidad
            </Link>
            {/* exact: on "Recuperar la cuenta" (/ingresar?modo=recuperar) this is not the current page. */}
            <Link to="/ingresar" activeOptions={{ exact: true }} className="-my-3 inline-flex min-h-11 items-center hover:text-ink">
              Ingresar
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
