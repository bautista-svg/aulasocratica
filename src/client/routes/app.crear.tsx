import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { optionalUuid, searchParams } from "@client/lib/search";
import { PageSpinner } from "@client/components/ui/spinner";
import { useMe } from "@client/lib/session";
import { CreateWizard } from "@client/features/planning/create-wizard";

export const Route = createFileRoute("/app/crear")({
  validateSearch: searchParams({ aula: optionalUuid }),
  component: CreatePage,
});

function CreatePage() {
  const { aula } = Route.useSearch();
  const me = useMe();
  useEffect(() => {
    document.title = "Crear con IA · Aula Socrática";
  }, []);
  const teacherId = me.data?.teacher?.id;
  if (!teacherId) return <PageSpinner />;
  // Keyed by workspace: the saved wizard belongs to this workspace only.
  return <CreateWizard key={teacherId} teacherId={teacherId} aula={aula} />;
}
