import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PageSpinner } from "@client/components/ui/spinner";
import { useMe } from "@client/lib/session";
import { usePageTitle } from "@client/lib/page-title";
import { CreateWizard } from "@client/features/planning/create-wizard";

export const Route = createFileRoute("/app/crear")({
  validateSearch: z.object({ aula: z.string().uuid().optional() }),
  component: CreatePage,
});

function CreatePage() {
  const { aula } = Route.useSearch();
  const me = useMe();
  usePageTitle("Crear con IA");
  const teacherId = me.data?.teacher?.id;
  if (!teacherId) return <PageSpinner />;
  // Keyed by workspace: the saved wizard belongs to this workspace only.
  return <CreateWizard key={teacherId} teacherId={teacherId} aula={aula} />;
}
