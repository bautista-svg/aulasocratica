import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Toaster } from "sonner";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
});

function Root() {
  return (
    <>
      <a
        href="#contenido"
        className="sr-only z-[60] rounded-md bg-ink px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:inline-flex focus:min-h-11 focus:items-center"
      >
        Saltar al contenido
      </a>
      <Outlet />
      <Toaster
        position="top-center"
        closeButton
        containerAriaLabel="Avisos"
        toastOptions={{
          closeButtonAriaLabel: "Cerrar aviso",
          classNames: {
            toast: "!rounded-md !border !border-line !bg-surface !text-text !shadow-pop !font-sans",
            title: "!text-[15px] !font-semibold",
            description: "!text-sm !text-text-2",
            error: "!border-rose/30",
            success: "!border-leaf/30",
          },
        }}
      />
    </>
  );
}
