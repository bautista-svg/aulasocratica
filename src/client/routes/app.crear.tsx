import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// TODO(module owner): placeholder — replace with the real "Crear con IA" wizard.
export const Route = createFileRoute("/app/crear")({
  validateSearch: z.object({ aula: z.string().uuid().optional() }),
  component: () => <p className="p-8 text-text-2">Pantalla pendiente.</p>,
});
