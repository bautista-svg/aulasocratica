import { Suspense, lazy, useState } from "react";
import { Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
});

// sonner is loaded on demand: the landing, the student page and the privacy page never show a
// toast, so they do not download it. Once mounted, the container stays (toasts created before it
// mounts are replayed by sonner).
const AppToaster = lazy(() => import("@client/components/app/toaster"));
const withoutToasts = (path: string) => path === "/" || path === "/privacidad" || path.startsWith("/clase/");

function Root() {
  const needsToaster = useRouterState({ select: (s) => !withoutToasts(s.location.pathname) });
  const [toaster, setToaster] = useState(needsToaster);
  if (needsToaster && !toaster) setToaster(true);
  return (
    <>
      <a
        href="#contenido"
        className="sr-only z-[60] rounded-md bg-ink px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:inline-flex focus:min-h-11 focus:items-center"
      >
        Saltar al contenido
      </a>
      <Outlet />
      {toaster ? (
        <Suspense fallback={null}>
          <AppToaster />
        </Suspense>
      ) : null}
    </>
  );
}
