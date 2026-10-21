import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Logo } from "../brand/logo";
import { Button, buttonClass } from "../ui/button";
import { errorMessage } from "@client/lib/api";

export function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-8" />
      <p className="q-hang font-display text-2xl text-ink">¿Seguro que era esta dirección?</p>
      <p className="mt-4 text-text-2">La página que buscás no existe o cambió de lugar.</p>
      <Link to="/" className={buttonClass("primary", "md", "mt-6")}>
        Ir al inicio
      </Link>
    </main>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <main role="alert" className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-2xl font-semibold text-ink">Algo salió mal</h1>
      <p className="mt-3 text-text-2">{errorMessage(error) || "No pudimos mostrar esta pantalla."}</p>
      <div className="mt-6 flex gap-2">
        <Button
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          Reintentar
        </Button>
        <Link to="/" className={buttonClass("secondary")}>
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
