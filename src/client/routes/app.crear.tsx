import { createFileRoute } from "@tanstack/react-router";
import { optionalUuid, searchParams } from "@client/lib/search";
import { PageSpinner } from "@client/components/ui/spinner";
import { useMe } from "@client/lib/session";
import { usePageTitle } from "@client/lib/page-title";
import { CreateWizard } from "@client/features/planning/create-wizard";

export const Route = createFileRoute("/app/crear")({
  validateSearch: searchParams({ aula: optionalUuid }),
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
