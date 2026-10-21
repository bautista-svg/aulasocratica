import { createFileRoute } from "@tanstack/react-router";

// TODO(module owner): placeholder — replace with the real screen.
export const Route = createFileRoute("/app/sesiones/$sessionId")({
  component: () => <p className="p-8 text-text-2">Pantalla pendiente.</p>,
});
